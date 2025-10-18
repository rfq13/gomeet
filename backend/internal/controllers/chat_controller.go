package controllers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/your-org/gomeet-backend/internal/models"
	"github.com/your-org/gomeet-backend/internal/services"
	"github.com/your-org/gomeet-backend/internal/utils"
)

type ChatController struct {
	chatService *services.ChatService
}

func NewChatController(chatService *services.ChatService) *ChatController {
	return &ChatController{
		chatService: chatService,
	}
}

// GetMessages retrieves paginated chat messages for a meeting
func (c *ChatController) GetMessages(ctx *gin.Context) {
	// Get meeting ID from URL parameter
	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	// Parse pagination parameters
	page, err := strconv.Atoi(ctx.DefaultQuery("page", "1"))
	if err != nil || page < 1 {
		page = 1
	}

	limit, err := strconv.Atoi(ctx.DefaultQuery("limit", "50"))
	if err != nil || limit < 1 || limit > 100 {
		limit = 50
	}

	// Get time filters
	before := ctx.Query("before")
	after := ctx.Query("after")

	// Get messages
	messages, pagination, err := c.chatService.GetMessages(meetingID, page, limit, before, after)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusInternalServerError, "GET_MESSAGES_FAILED", "Failed to get messages")
		return
	}

	// Convert to response format
	var messageResponses []models.ChatMessageResponse
	for _, message := range messages {
		messageResponses = append(messageResponses, message.ToResponse())
	}

	response := models.GetChatMessagesResponse{
		Messages:   messageResponses,
		Pagination: pagination,
	}

	utils.SuccessResponse(ctx, http.StatusOK, response, "Messages retrieved successfully")
}

// SendMessage sends a new chat message
func (c *ChatController) SendMessage(ctx *gin.Context) {
	// Get meeting ID from URL parameter
	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	// Parse request body
	var req models.CreateChatMessageRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request format")
		return
	}

	// Validate required fields
	if req.Content == "" || strings.TrimSpace(req.Content) == "" {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_CONTENT", "Message content cannot be empty")
		return
	}

	// Set meeting ID
	req.MeetingID = meetingID

	// Get user info from context (authenticated user)
	userID, exists := ctx.Get("userID")
	var userIDPtr *uuid.UUID
	if exists {
		if uid, ok := userID.(uuid.UUID); ok {
			userIDPtr = &uid
		}
	}

	// Check if user has access to the meeting
	if userIDPtr != nil {
		if !c.chatService.HasMeetingAccess(*userIDPtr, meetingID) {
			utils.ForbiddenResponse(ctx, "Access denied")
			return
		}
	}

	// Handle public user
	var publicUserID *uuid.UUID
	if userIDPtr == nil {
		// Get session ID from query parameter for public users
		sessionID := ctx.Query("sessionId")
		if sessionID == "" {
			utils.SendErrorResponse(ctx, http.StatusBadRequest, "SESSION_REQUIRED", "Session ID required for public users")
			return
		}

		// Get public user
		publicUser, err := c.chatService.GetPublicUserBySessionID(sessionID)
		if err != nil {
			utils.UnauthorizedResponse(ctx, "Invalid session")
			return
		}
		publicUserID = &publicUser.ID
	}

	// Send message
	message, err := c.chatService.SendMessage(userIDPtr, publicUserID, &req)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusInternalServerError, "SEND_MESSAGE_FAILED", err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusCreated, message.ToResponse(), "Message sent successfully")
}

// UpdateMessage updates an existing chat message
func (c *ChatController) UpdateMessage(ctx *gin.Context) {
	// Get message ID from URL parameter
	messageIDStr := ctx.Param("messageId")
	messageID, err := uuid.Parse(messageIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MESSAGE_ID", "Invalid message ID")
		return
	}

	// Get user ID from context
	userID, exists := ctx.Get("userID")
	if !exists {
		utils.UnauthorizedResponse(ctx, "Authentication required")
		return
	}

	uid, ok := userID.(uuid.UUID)
	if !ok {
		utils.SendErrorResponse(ctx, http.StatusInternalServerError, "INVALID_USER_ID", "Invalid user ID format")
		return
	}

	// Parse request body
	var req models.UpdateChatMessageRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request format")
		return
	}

	// Validate content if provided
	if req.Content != nil && (strings.TrimSpace(*req.Content) == "") {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_CONTENT", "Message content cannot be empty")
		return
	}

	// Update message
	message, err := c.chatService.UpdateMessage(uid, messageID, &req)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusInternalServerError, "UPDATE_MESSAGE_FAILED", err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, message.ToResponse(), "Message updated successfully")
}

// MarkMessageRead marks a message as read
func (c *ChatController) MarkMessageRead(ctx *gin.Context) {
	// Get message ID from URL parameter
	messageIDStr := ctx.Param("messageId")
	messageID, err := uuid.Parse(messageIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MESSAGE_ID", "Invalid message ID")
		return
	}

	// Get user info from context (authenticated user)
	userID, exists := ctx.Get("userID")
	var userIDPtr *uuid.UUID
	if exists {
		if uid, ok := userID.(uuid.UUID); ok {
			userIDPtr = &uid
		}
	}

	// Handle public user
	var publicUserID *uuid.UUID
	if userIDPtr == nil {
		// Get session ID from query parameter for public users
		sessionID := ctx.Query("sessionId")
		if sessionID == "" {
			utils.SendErrorResponse(ctx, http.StatusBadRequest, "SESSION_REQUIRED", "Session ID required for public users")
			return
		}

		// Get public user
		publicUser, err := c.chatService.GetPublicUserBySessionID(sessionID)
		if err != nil {
			utils.UnauthorizedResponse(ctx, "Invalid session")
			return
		}
		publicUserID = &publicUser.ID
	}

	// Mark message as read
	if err := c.chatService.MarkMessageRead(userIDPtr, publicUserID, messageID); err != nil {
		utils.SendErrorResponse(ctx, http.StatusInternalServerError, "MARK_READ_FAILED", err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, nil, "Message marked as read")
}

// ToggleReaction adds or removes a reaction to a message
func (c *ChatController) ToggleReaction(ctx *gin.Context) {
	// Get message ID from URL parameter
	messageIDStr := ctx.Param("messageId")
	messageID, err := uuid.Parse(messageIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MESSAGE_ID", "Invalid message ID")
		return
	}

	// Get user info from context (authenticated user)
	userID, exists := ctx.Get("userID")
	var userIDPtr *uuid.UUID
	if exists {
		if uid, ok := userID.(uuid.UUID); ok {
			userIDPtr = &uid
		}
	}

	// Handle public user
	var publicUserID *uuid.UUID
	if userIDPtr == nil {
		// Get session ID from query parameter for public users
		sessionID := ctx.Query("sessionId")
		if sessionID == "" {
			utils.SendErrorResponse(ctx, http.StatusBadRequest, "SESSION_REQUIRED", "Session ID required for public users")
			return
		}

		// Get public user
		publicUser, err := c.chatService.GetPublicUserBySessionID(sessionID)
		if err != nil {
			utils.UnauthorizedResponse(ctx, "Invalid session")
			return
		}
		publicUserID = &publicUser.ID
	}

	// Parse request body
	var req models.CreateChatMessageReactionRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request format")
		return
	}

	// Set message ID
	req.MessageID = messageID

	// Toggle reaction
	reaction, err := c.chatService.ToggleReaction(userIDPtr, publicUserID, &req)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusInternalServerError, "TOGGLE_REACTION_FAILED", err.Error())
		return
	}

	if reaction == nil {
		// Reaction was removed
		utils.SuccessResponse(ctx, http.StatusOK, nil, "Reaction removed")
	} else {
		// Reaction was added
		utils.SuccessResponse(ctx, http.StatusCreated, reaction.ToResponse(), "Reaction added")
	}
}

// GetUnreadCount returns the number of unread messages for a user in a meeting
func (c *ChatController) GetUnreadCount(ctx *gin.Context) {
	// Get meeting ID from URL parameter
	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	// Get user info from context (authenticated user)
	userID, exists := ctx.Get("userID")
	var userIDPtr *uuid.UUID
	if exists {
		if uid, ok := userID.(uuid.UUID); ok {
			userIDPtr = &uid
		}
	}

	// Handle public user
	var publicUserID *uuid.UUID
	if userIDPtr == nil {
		// Get session ID from query parameter for public users
		sessionID := ctx.Query("sessionId")
		if sessionID == "" {
			utils.SendErrorResponse(ctx, http.StatusBadRequest, "SESSION_REQUIRED", "Session ID required for public users")
			return
		}

		// Get public user
		publicUser, err := c.chatService.GetPublicUserBySessionID(sessionID)
		if err != nil {
			utils.UnauthorizedResponse(ctx, "Invalid session")
			return
		}
		publicUserID = &publicUser.ID
	}

	// Get unread count
	count, err := c.chatService.GetUnreadCount(userIDPtr, publicUserID, meetingID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusInternalServerError, "GET_UNREAD_COUNT_FAILED", err.Error())
		return
	}

	response := models.GetUnreadCountResponse{
		UnreadCount: count,
	}

	utils.SuccessResponse(ctx, http.StatusOK, response, "Unread count retrieved successfully")
}