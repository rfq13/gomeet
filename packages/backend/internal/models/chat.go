package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type MessageType string

const (
	MessageTypeText     MessageType = "text"
	MessageTypeImage    MessageType = "image"
	MessageTypeFile     MessageType = "file"
	MessageTypeSystem   MessageType = "system"
	MessageTypeReaction MessageType = "reaction"
)

type MessageStatus string

const (
	MessageStatusSent     MessageStatus = "sent"
	MessageStatusDelivered MessageStatus = "delivered"
	MessageStatusRead     MessageStatus = "read"
	MessageStatusFailed   MessageStatus = "failed"
)

type ChatMessage struct {
	ID            uuid.UUID     `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	MeetingID     uuid.UUID     `gorm:"type:uuid;not null" json:"meetingId"`
	UserID        *uuid.UUID    `gorm:"type:uuid;default:null" json:"userId,omitempty"`
	PublicUserID  *uuid.UUID    `gorm:"type:uuid;default:null" json:"publicUserId,omitempty"`
	MessageType   MessageType   `gorm:"type:varchar(20);not null;default:'text'" json:"messageType"`
	Content       string        `gorm:"type:text;not null" json:"content"`
	ReplyToID     *uuid.UUID    `gorm:"type:uuid;default:null" json:"replyToId,omitempty"`
	AttachmentURL string        `gorm:"size:500" json:"attachmentUrl,omitempty"`
	AttachmentType string       `gorm:"size:50" json:"attachmentType,omitempty"`
	AttachmentName string       `gorm:"size:255" json:"attachmentName,omitempty"`
	IsEdited      bool          `gorm:"default:false" json:"isEdited"`
	EditedAt      *time.Time    `json:"editedAt,omitempty"`
	IsDeleted     bool          `gorm:"default:false" json:"isDeleted"`
	DeletedAt     *time.Time    `json:"deletedAt,omitempty"`
	MessageStatus MessageStatus `gorm:"type:varchar(20);default:'sent'" json:"messageStatus"`
	CreatedAt     time.Time     `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt     time.Time     `gorm:"autoUpdateTime" json:"updatedAt"`

	// Relationships
	Meeting       Meeting                    `gorm:"foreignKey:MeetingID" json:"meeting,omitempty"`
	User          *User                      `gorm:"foreignKey:UserID" json:"user,omitempty"`
	PublicUser    *PublicUser                `gorm:"foreignKey:PublicUserID" json:"publicUser,omitempty"`
	ReplyTo       *ChatMessage               `gorm:"foreignKey:ReplyToID" json:"replyTo,omitempty"`
	Replies       []ChatMessage              `gorm:"foreignKey:ReplyToID" json:"replies,omitempty"`
	ReadStatus    []ChatMessageReadStatus    `gorm:"foreignKey:MessageID" json:"readStatus,omitempty"`
	Reactions     []ChatMessageReaction      `gorm:"foreignKey:MessageID" json:"reactions,omitempty"`
}

type ChatMessageResponse struct {
	ID             uuid.UUID                 `json:"id"`
	MeetingID      uuid.UUID                 `json:"meetingId"`
	UserID         *uuid.UUID                `json:"userId,omitempty"`
	PublicUserID   *uuid.UUID                `json:"publicUserId,omitempty"`
	MessageType    MessageType               `json:"messageType"`
	Content        string                    `json:"content"`
	ReplyToID      *uuid.UUID                `json:"replyToId,omitempty"`
	AttachmentURL  string                    `json:"attachmentUrl,omitempty"`
	AttachmentType string                    `json:"attachmentType,omitempty"`
	AttachmentName string                    `json:"attachmentName,omitempty"`
	IsEdited       bool                      `json:"isEdited"`
	EditedAt       *time.Time                `json:"editedAt,omitempty"`
	IsDeleted      bool                      `json:"isDeleted"`
	DeletedAt      *time.Time                `json:"deletedAt,omitempty"`
	MessageStatus  MessageStatus             `json:"messageStatus"`
	CreatedAt      time.Time                 `json:"createdAt"`
	UpdatedAt      time.Time                 `json:"updatedAt"`

	// Included relationships
	User           *UserResponse             `json:"user,omitempty"`
	PublicUser     *PublicUserResponse       `json:"publicUser,omitempty"`
	ReplyTo        *ChatMessageResponse      `json:"replyTo,omitempty"`
	Replies        []ChatMessageResponse     `json:"replies,omitempty"`
	ReadStatus     []ChatMessageReadStatusResponse `json:"readStatus,omitempty"`
	Reactions      []ChatMessageReactionResponse `json:"reactions,omitempty"`
}

type CreateChatMessageRequest struct {
	MeetingID      uuid.UUID  `json:"meetingId" validate:"required"`
	MessageType    MessageType `json:"messageType" validate:"required"`
	Content        string     `json:"content" validate:"required,max=2000"`
	ReplyToID      *uuid.UUID `json:"replyToId,omitempty"`
	AttachmentURL  string     `json:"attachmentUrl,omitempty"`
	AttachmentType string     `json:"attachmentType,omitempty"`
	AttachmentName string     `json:"attachmentName,omitempty"`
}

type UpdateChatMessageRequest struct {
	Content        *string `json:"content,omitempty" validate:"omitempty,max=2000"`
	IsDeleted      *bool   `json:"isDeleted,omitempty"`
}

type ChatMessageListResponse struct {
	Messages   []ChatMessageResponse `json:"messages"`
	Pagination PaginationInfo        `json:"pagination"`
}

type GetChatMessagesResponse struct {
	Messages   []ChatMessageResponse `json:"messages"`
	Pagination PaginationInfo        `json:"pagination"`
}

type GetUnreadCountResponse struct {
	UnreadCount int `json:"unreadCount"`
}

func (m *ChatMessage) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}

func (m *ChatMessage) ToResponse() ChatMessageResponse {
	response := ChatMessageResponse{
		ID:             m.ID,
		MeetingID:      m.MeetingID,
		UserID:         m.UserID,
		PublicUserID:   m.PublicUserID,
		MessageType:    m.MessageType,
		Content:        m.Content,
		ReplyToID:      m.ReplyToID,
		AttachmentURL:  m.AttachmentURL,
		AttachmentType: m.AttachmentType,
		AttachmentName: m.AttachmentName,
		IsEdited:       m.IsEdited,
		EditedAt:       m.EditedAt,
		IsDeleted:      m.IsDeleted,
		DeletedAt:      m.DeletedAt,
		MessageStatus:  m.MessageStatus,
		CreatedAt:      m.CreatedAt,
		UpdatedAt:      m.UpdatedAt,
	}

	// Include relationships
	if m.User != nil {
		userResponse := m.User.ToResponse()
		response.User = &userResponse
	}

	if m.PublicUser != nil {
		publicUserResponse := m.PublicUser.ToResponse()
		response.PublicUser = &publicUserResponse
	}

	if m.ReplyTo != nil {
		replyToResponse := m.ReplyTo.ToResponse()
		response.ReplyTo = &replyToResponse
	}

	for _, reply := range m.Replies {
		response.Replies = append(response.Replies, reply.ToResponse())
	}

	for _, status := range m.ReadStatus {
		response.ReadStatus = append(response.ReadStatus, status.ToResponse())
	}

	for _, reaction := range m.Reactions {
		response.Reactions = append(response.Reactions, reaction.ToResponse())
	}

	return response
}

type ChatMessageReadStatus struct {
	ID           uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	MessageID    uuid.UUID  `gorm:"type:uuid;not null" json:"messageId"`
	UserID       *uuid.UUID `gorm:"type:uuid;default:null" json:"userId,omitempty"`
	PublicUserID *uuid.UUID `gorm:"type:uuid;default:null" json:"publicUserId,omitempty"`
	ReadAt       time.Time  `gorm:"autoCreateTime" json:"readAt"`

	// Relationships
	Message    ChatMessage  `gorm:"foreignKey:MessageID" json:"message,omitempty"`
	User       *User        `gorm:"foreignKey:UserID" json:"user,omitempty"`
	PublicUser *PublicUser  `gorm:"foreignKey:PublicUserID" json:"publicUser,omitempty"`
}

type ChatMessageReadStatusResponse struct {
	ID           uuid.UUID  `json:"id"`
	MessageID    uuid.UUID  `json:"messageId"`
	UserID       *uuid.UUID `json:"userId,omitempty"`
	PublicUserID *uuid.UUID `json:"publicUserId,omitempty"`
	ReadAt       time.Time  `json:"readAt"`

	User         *UserResponse       `json:"user,omitempty"`
	PublicUser   *PublicUserResponse `json:"publicUser,omitempty"`
}

func (m *ChatMessageReadStatus) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}

func (m *ChatMessageReadStatus) ToResponse() ChatMessageReadStatusResponse {
	response := ChatMessageReadStatusResponse{
		ID:           m.ID,
		MessageID:    m.MessageID,
		UserID:       m.UserID,
		PublicUserID: m.PublicUserID,
		ReadAt:       m.ReadAt,
	}

	if m.User != nil {
		userResponse := m.User.ToResponse()
		response.User = &userResponse
	}

	if m.PublicUser != nil {
		publicUserResponse := m.PublicUser.ToResponse()
		response.PublicUser = &publicUserResponse
	}

	return response
}

type ChatMessageReaction struct {
	ID           uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	MessageID    uuid.UUID  `gorm:"type:uuid;not null" json:"messageId"`
	UserID       *uuid.UUID `gorm:"type:uuid;default:null" json:"userId,omitempty"`
	PublicUserID *uuid.UUID `gorm:"type:uuid;default:null" json:"publicUserId,omitempty"`
	Reaction     string     `gorm:"size:10;not null" json:"reaction"`
	CreatedAt    time.Time  `gorm:"autoCreateTime" json:"createdAt"`

	// Relationships
	Message    ChatMessage  `gorm:"foreignKey:MessageID" json:"message,omitempty"`
	User       *User        `gorm:"foreignKey:UserID" json:"user,omitempty"`
	PublicUser *PublicUser  `gorm:"foreignKey:PublicUserID" json:"publicUser,omitempty"`
}

type ChatMessageReactionResponse struct {
	ID           uuid.UUID  `json:"id"`
	MessageID    uuid.UUID  `json:"messageId"`
	UserID       *uuid.UUID `json:"userId,omitempty"`
	PublicUserID *uuid.UUID `json:"publicUserId,omitempty"`
	Reaction     string     `json:"reaction"`
	CreatedAt    time.Time  `json:"createdAt"`

	User         *UserResponse       `json:"user,omitempty"`
	PublicUser   *PublicUserResponse `json:"publicUser,omitempty"`
}

type CreateChatMessageReactionRequest struct {
	MessageID uuid.UUID `json:"messageId" validate:"required"`
	Reaction  string    `json:"reaction" validate:"required,max=10"`
}

func (r *ChatMessageReaction) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}

func (r *ChatMessageReaction) ToResponse() ChatMessageReactionResponse {
	response := ChatMessageReactionResponse{
		ID:           r.ID,
		MessageID:    r.MessageID,
		UserID:       r.UserID,
		PublicUserID: r.PublicUserID,
		Reaction:     r.Reaction,
		CreatedAt:    r.CreatedAt,
	}

	if r.User != nil {
		userResponse := r.User.ToResponse()
		response.User = &userResponse
	}

	if r.PublicUser != nil {
		publicUserResponse := r.PublicUser.ToResponse()
		response.PublicUser = &publicUserResponse
	}

	return response
}