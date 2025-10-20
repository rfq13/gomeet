package services

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/your-org/gomeet/packages/backend/internal/models"
)

type ChatService struct {
	db                *gorm.DB
	webSocketService  *WebSocketService
	publicUserService *PublicUserService
}

func NewChatService(db *gorm.DB, webSocketService *WebSocketService, publicUserService *PublicUserService) *ChatService {
	return &ChatService{
		db:                db,
		webSocketService:  webSocketService,
		publicUserService: publicUserService,
	}
}

// GetMessages retrieves paginated chat messages for a meeting
func (s *ChatService) GetMessages(meetingID uuid.UUID, page, limit int, before, after string) ([]models.ChatMessage, models.PaginationInfo, error) {
	var messages []models.ChatMessage
	var total int64

	query := s.db.Where("meeting_id = ? AND is_deleted = ?", meetingID, false)

	// Apply time filters
	if before != "" {
		beforeTime, err := time.Parse(time.RFC3339, before)
		if err == nil {
			query = query.Where("created_at < ?", beforeTime)
		}
	}
	if after != "" {
		afterTime, err := time.Parse(time.RFC3339, after)
		if err == nil {
			query = query.Where("created_at > ?", afterTime)
		}
	}

	// Count total messages
	if err := query.Model(&models.ChatMessage{}).Count(&total).Error; err != nil {
		return nil, models.PaginationInfo{}, err
	}

	// Apply pagination
	offset := (page - 1) * limit
	if err := query.
		Preload("User").
		Preload("PublicUser").
		Preload("ReplyTo").
		Preload("Replies", "is_deleted = ?", false).
		Preload("Replies.User").
		Preload("Replies.PublicUser").
		Preload("ReadStatus").
		Preload("ReadStatus.User").
		Preload("ReadStatus.PublicUser").
		Preload("Reactions").
		Preload("Reactions.User").
		Preload("Reactions.PublicUser").
		Order("created_at DESC").
		Offset(offset).
		Limit(limit).
		Find(&messages).Error; err != nil {
		return nil, models.PaginationInfo{}, err
	}

	// Reverse order to show oldest first
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	pagination := models.PaginationInfo{
		Page:       page,
		Limit:      limit,
		Total:      int(total),
		TotalPages: int((total + int64(limit) - 1) / int64(limit)),
	}

	return messages, pagination, nil
}

// SendMessage creates and sends a new chat message
func (s *ChatService) SendMessage(userID *uuid.UUID, publicUserID *uuid.UUID, req *models.CreateChatMessageRequest) (*models.ChatMessage, error) {
	// Validate content
	if strings.TrimSpace(req.Content) == "" {
		return nil, fmt.Errorf("message content cannot be empty")
	}

	// Sanitize content (basic XSS prevention)
	req.Content = strings.TrimSpace(req.Content)

	// Create message
	message := models.ChatMessage{
		MeetingID:      req.MeetingID,
		UserID:         userID,
		PublicUserID:   publicUserID,
		MessageType:    req.MessageType,
		Content:        req.Content,
		ReplyToID:      req.ReplyToID,
		AttachmentURL:  req.AttachmentURL,
		AttachmentType: req.AttachmentType,
		AttachmentName: req.AttachmentName,
		MessageStatus:  models.MessageStatusSent,
	}

	// Validate reply to exists if specified
	if req.ReplyToID != nil {
		var replyTo models.ChatMessage
		if err := s.db.Where("id = ? AND meeting_id = ? AND is_deleted = ?",
			*req.ReplyToID, req.MeetingID, false).First(&replyTo).Error; err != nil {
			return nil, fmt.Errorf("reply to message not found")
		}
	}

	// Save message
	if err := s.db.Create(&message).Error; err != nil {
		return nil, fmt.Errorf("failed to create message: %w", err)
	}

	// Load relationships
	if err := s.loadMessageRelationships(&message); err != nil {
		return nil, fmt.Errorf("failed to load message relationships: %w", err)
	}

	// Broadcast via WebSocket
	go s.broadcastMessage(&message)

	return &message, nil
}

// UpdateMessage updates an existing chat message
func (s *ChatService) UpdateMessage(userID uuid.UUID, messageID uuid.UUID, req *models.UpdateChatMessageRequest) (*models.ChatMessage, error) {
	var message models.ChatMessage

	// Find message
	if err := s.db.Where("id = ? AND is_deleted = ?", messageID, false).First(&message).Error; err != nil {
		return nil, fmt.Errorf("message not found")
	}

	// Check ownership
	if userID != *message.UserID {
		return nil, fmt.Errorf("unauthorized")
	}

	// Update fields
	updates := make(map[string]interface{})
	if req.Content != nil {
		content := strings.TrimSpace(*req.Content)
		if content == "" {
			return nil, fmt.Errorf("message content cannot be empty")
		}
		updates["content"] = content
		updates["is_edited"] = true
		updates["edited_at"] = time.Now()
	}

	if req.IsDeleted != nil {
		if *req.IsDeleted {
			updates["is_deleted"] = true
			updates["deleted_at"] = time.Now()
		}
	}

	// Apply updates
	if err := s.db.Model(&message).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("failed to update message: %w", err)
	}

	// Reload message with relationships
	if err := s.db.Where("id = ?", messageID).
		Preload("User").
		Preload("PublicUser").
		Preload("ReplyTo").
		Preload("Replies").
		Preload("ReadStatus").
		Preload("Reactions").
		First(&message).Error; err != nil {
		return nil, fmt.Errorf("failed to reload message: %w", err)
	}

	// Broadcast update via WebSocket
	go s.broadcastMessageUpdate(&message, req.IsDeleted != nil && *req.IsDeleted)

	return &message, nil
}

// MarkMessageRead marks a message as read for a user
func (s *ChatService) MarkMessageRead(userID *uuid.UUID, publicUserID *uuid.UUID, messageID uuid.UUID) error {
	// Verify message exists
	var message models.ChatMessage
	if err := s.db.Where("id = ? AND is_deleted = ?", messageID, false).First(&message).Error; err != nil {
		return fmt.Errorf("message not found")
	}

	// Check if already read
	var existingStatus models.ChatMessageReadStatus
	query := s.db.Where("message_id = ?", messageID)
	if userID != nil {
		query = query.Where("user_id = ?", *userID)
	} else {
		query = query.Where("public_user_id = ?", *publicUserID)
	}

	if err := query.First(&existingStatus).Error; err == nil {
		return nil // Already marked as read
	}

	// Create read status
	readStatus := models.ChatMessageReadStatus{
		MessageID:    messageID,
		UserID:       userID,
		PublicUserID: publicUserID,
	}

	if err := s.db.Create(&readStatus).Error; err != nil {
		return fmt.Errorf("failed to mark message as read: %w", err)
	}

	// Update message status if all participants have read it
	go s.updateMessageStatus(&message)

	// Broadcast read status via WebSocket
	go s.broadcastReadStatus(&readStatus)

	return nil
}

// ToggleReaction adds or removes a reaction to a message
func (s *ChatService) ToggleReaction(userID *uuid.UUID, publicUserID *uuid.UUID, req *models.CreateChatMessageReactionRequest) (*models.ChatMessageReaction, error) {
	// Verify message exists
	var message models.ChatMessage
	if err := s.db.Where("id = ? AND is_deleted = ?", req.MessageID, false).First(&message).Error; err != nil {
		return nil, fmt.Errorf("message not found")
	}

	// Check if reaction already exists
	var existingReaction models.ChatMessageReaction
	query := s.db.Where("message_id = ? AND reaction = ?", req.MessageID, req.Reaction)
	if userID != nil {
		query = query.Where("user_id = ?", *userID)
	} else {
		query = query.Where("public_user_id = ?", *publicUserID)
	}

	if err := query.First(&existingReaction).Error; err == nil {
		// Remove existing reaction
		if err := s.db.Delete(&existingReaction).Error; err != nil {
			return nil, fmt.Errorf("failed to remove reaction: %w", err)
		}

		// Broadcast reaction removal
		go s.broadcastReactionRemoval(&existingReaction)
		return nil, nil
	}

	// Add new reaction
	reaction := models.ChatMessageReaction{
		MessageID:    req.MessageID,
		UserID:       userID,
		PublicUserID: publicUserID,
		Reaction:     req.Reaction,
	}

	if err := s.db.Create(&reaction).Error; err != nil {
		return nil, fmt.Errorf("failed to add reaction: %w", err)
	}

	// Load relationships
	if err := s.db.Preload("User").Preload("PublicUser").First(&reaction).Error; err != nil {
		return nil, fmt.Errorf("failed to load reaction relationships: %w", err)
	}

	// Broadcast reaction addition
	go s.broadcastReactionAddition(&reaction)

	return &reaction, nil
}

// GetUnreadCount returns the number of unread messages for a user in a meeting
func (s *ChatService) GetUnreadCount(userID *uuid.UUID, publicUserID *uuid.UUID, meetingID uuid.UUID) (int, error) {
	var count int64

	// Subquery to get messages the user has already read
	readMessagesQuery := s.db.Model(&models.ChatMessageReadStatus{}).
		Select("message_id")
	if userID != nil {
		readMessagesQuery = readMessagesQuery.Where("user_id = ?", *userID)
	} else {
		readMessagesQuery = readMessagesQuery.Where("public_user_id = ?", *publicUserID)
	}

	// Count messages that are not deleted and not read by the user
	query := s.db.Model(&models.ChatMessage{}).
		Where("meeting_id = ? AND is_deleted = ?", meetingID, false).
		Where("id NOT IN (?)", readMessagesQuery)

	// Exclude user's own messages
	if userID != nil {
		query = query.Where("user_id != ? OR user_id IS NULL", *userID)
	} else {
		query = query.Where("public_user_id != ? OR public_user_id IS NULL", *publicUserID)
	}

	if err := query.Count(&count).Error; err != nil {
		return 0, fmt.Errorf("failed to get unread count: %w", err)
	}

	return int(count), nil
}

// HasMeetingAccess checks if a user has access to a meeting
func (s *ChatService) HasMeetingAccess(userID uuid.UUID, meetingID uuid.UUID) bool {
	// Check if user is the meeting host
	var meeting models.Meeting
	if err := s.db.Where("id = ? AND host_id = ?", meetingID, userID).First(&meeting).Error; err == nil {
		return true
	}

	// Check if user is a participant
	var participant models.Participant
	if err := s.db.Where("meeting_id = ? AND user_id = ? AND is_active = ?",
		meetingID, userID, true).First(&participant).Error; err == nil {
		return true
	}

	return false
}

// GetPublicUserBySessionID retrieves a public user by session ID
func (s *ChatService) GetPublicUserBySessionID(sessionID string) (models.PublicUser, error) {
	var publicUser models.PublicUser
	if err := s.db.Where("session_id = ?", sessionID).First(&publicUser).Error; err != nil {
		return models.PublicUser{}, fmt.Errorf("public user not found")
	}
	return publicUser, nil
}

// Helper methods

func (s *ChatService) loadMessageRelationships(message *models.ChatMessage) error {
	return s.db.Where("id = ?", message.ID).
		Preload("User").
		Preload("PublicUser").
		Preload("ReplyTo").
		Preload("Replies", "is_deleted = ?", false).
		Preload("Replies.User").
		Preload("Replies.PublicUser").
		Preload("ReadStatus").
		Preload("ReadStatus.User").
		Preload("ReadStatus.PublicUser").
		Preload("Reactions").
		Preload("Reactions.User").
		Preload("Reactions.PublicUser").
		First(message).Error
}

func (s *ChatService) broadcastMessage(message *models.ChatMessage) {
	// Create WebSocket payload that matches frontend expectations
	payload := map[string]interface{}{
		"message": message.ToResponse(),
	}

	// Broadcast to meeting participants
	wsMessage := models.SignalingMessage{
		Type:      models.SignalingTypeChatMessage,
		MeetingID: message.MeetingID.String(),
		Data:      payload,
		Timestamp: time.Now(),
	}

	s.webSocketService.SendMessageToMeeting(message.MeetingID.String(), wsMessage)
}

func (s *ChatService) broadcastMessageUpdate(message *models.ChatMessage, isDeleted bool) {
	messageType := models.SignalingTypeChatMessageEdit
	if isDeleted {
		messageType = models.SignalingTypeChatMessageDelete
	}

	// Create WebSocket payload that matches frontend expectations
	payload := map[string]interface{}{
		"message": message.ToResponse(),
	}

	wsMessage := models.SignalingMessage{
		Type:      messageType,
		MeetingID: message.MeetingID.String(),
		Data:      payload,
		Timestamp: time.Now(),
	}

	s.webSocketService.SendMessageToMeeting(message.MeetingID.String(), wsMessage)
}

func (s *ChatService) broadcastReadStatus(readStatus *models.ChatMessageReadStatus) {
	// Get meeting ID from message
	var message models.ChatMessage
	if err := s.db.Select("meeting_id").Where("id = ?", readStatus.MessageID).First(&message).Error; err == nil {
		// Create WebSocket payload that matches frontend expectations
		payload := map[string]interface{}{
			"messageId":   readStatus.MessageID.String(),
			"userId":      readStatus.UserID,
			"publicUserId": readStatus.PublicUserID,
			"readAt":      readStatus.ReadAt,
		}

		wsMessage := models.SignalingMessage{
			Type:      models.SignalingTypeChatReadStatus,
			MeetingID: message.MeetingID.String(),
			Data:      payload,
			Timestamp: time.Now(),
		}

		s.webSocketService.SendMessageToMeeting(message.MeetingID.String(), wsMessage)
	}
}

func (s *ChatService) broadcastReactionAddition(reaction *models.ChatMessageReaction) {
	// Get meeting ID from message
	var message models.ChatMessage
	if err := s.db.Select("meeting_id").Where("id = ?", reaction.MessageID).First(&message).Error; err == nil {
		// Create WebSocket payload that matches frontend expectations
		payload := map[string]interface{}{
			"message":   map[string]interface{}{"id": reaction.MessageID.String()},
			"reaction":  reaction.Reaction,
			"userId":    reaction.UserID,
			"publicUserId": reaction.PublicUserID,
		}

		wsMessage := models.SignalingMessage{
			Type:      models.SignalingTypeChatReaction,
			MeetingID: message.MeetingID.String(),
			Data:      payload,
			Timestamp: time.Now(),
		}
		s.webSocketService.SendMessageToMeeting(message.MeetingID.String(), wsMessage)
	}
}

func (s *ChatService) broadcastReactionRemoval(reaction *models.ChatMessageReaction) {
	// Get meeting ID from message
	var message models.ChatMessage
	if err := s.db.Select("meeting_id").Where("id = ?", reaction.MessageID).First(&message).Error; err == nil {
		// Create WebSocket payload that matches frontend expectations
		payload := map[string]interface{}{
			"message":   map[string]interface{}{"id": reaction.MessageID.String()},
			"reaction":  reaction.Reaction,
			"userId":    reaction.UserID,
			"publicUserId": reaction.PublicUserID,
		}

		wsMessage := models.SignalingMessage{
			Type:      models.SignalingTypeChatReaction,
			MeetingID: message.MeetingID.String(),
			Data:      payload,
			Timestamp: time.Now(),
		}
		s.webSocketService.SendMessageToMeeting(message.MeetingID.String(), wsMessage)
	}
}

func (s *ChatService) updateMessageStatus(message *models.ChatMessage) {
	// Get all active participants in the meeting
	var participantCount int64
	s.db.Model(&models.Participant{}).
		Where("meeting_id = ? AND is_active = ?", message.MeetingID, true).
		Count(&participantCount)

	// Get read count for this message
	var readCount int64
	s.db.Model(&models.ChatMessageReadStatus{}).
		Where("message_id = ?", message.ID).
		Count(&readCount)

	// If all participants have read the message, update status
	if int(readCount) >= int(participantCount) {
		s.db.Model(message).Update("message_status", models.MessageStatusRead)
	}
}