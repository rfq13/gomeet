package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Participant struct {
	ID           uuid.UUID   `gorm:"type:uuid;primary_key" json:"id"`
	MeetingID    uuid.UUID   `gorm:"type:uuid;not null" json:"meetingId"`
	UserID       *uuid.UUID  `gorm:"type:uuid;default:null" json:"userId"` // Nullable for public users
	PublicUserID *uuid.UUID  `gorm:"type:uuid;default:null" json:"publicUserId"` // Nullable for authenticated users
	Name         string      `gorm:"not null;size:255" json:"name" validate:"required,min=1,max=255"`
	AvatarURL    string      `gorm:"size:500" json:"avatarUrl,omitempty"`
	IsActive     bool        `gorm:"default:true" json:"isActive"`
	JoinedAt     time.Time   `gorm:"autoCreateTime" json:"joinedAt"`
	LeftAt       *time.Time  `json:"leftAt,omitempty"`
	CreatedAt    time.Time   `gorm:"autoCreateTime" json:"createdAt"`

	// Relationships
	Meeting    Meeting    `gorm:"foreignKey:MeetingID" json:"meeting,omitempty"`
	User       *User      `gorm:"foreignKey:UserID" json:"user,omitempty"`
	PublicUser *PublicUser `gorm:"foreignKey:PublicUserID" json:"publicUser,omitempty"`
}

type ParticipantResponse struct {
	ID           uuid.UUID  `json:"id"`
	UserID       *uuid.UUID `json:"userId"`
	PublicUserID *uuid.UUID `json:"publicUserId"`
	Name         string     `json:"name"`
	AvatarURL    string     `json:"avatarUrl,omitempty"`
	IsActive     bool       `json:"isActive"`
	JoinedAt     time.Time  `json:"joinedAt"`
	LeftAt       *time.Time `json:"leftAt,omitempty"`
}

type CreateParticipantRequest struct {
	Name      string `json:"name" validate:"required,min=1,max=255"`
	AvatarURL string `json:"avatarUrl,omitempty"`
}

type UpdateParticipantRequest struct {
	Name      *string `json:"name,omitempty" validate:"omitempty,min=1,max=255"`
	AvatarURL *string `json:"avatarUrl,omitempty"`
}

type JoinMeetingAsPublicUserRequest struct {
	SessionID string `json:"sessionId" validate:"required"`
	MeetingID string `json:"meetingId" validate:"required"`
}

type LeaveMeetingAsPublicUserRequest struct {
	SessionID string `json:"sessionId" validate:"required"`
	MeetingID string `json:"meetingId" validate:"required"`
}

func (p *Participant) ToResponse() ParticipantResponse {
	return ParticipantResponse{
		ID:           p.ID,
		UserID:       p.UserID,
		PublicUserID: p.PublicUserID,
		Name:         p.Name,
		AvatarURL:    p.AvatarURL,
		IsActive:     p.IsActive,
		JoinedAt:     p.JoinedAt,
		LeftAt:       p.LeftAt,
	}
}

// BeforeCreate hook to generate UUID
func (p *Participant) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}