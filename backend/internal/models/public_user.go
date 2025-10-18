package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type PublicUser struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	Name      string    `gorm:"not null" json:"name"`
	SessionID string    `gorm:"not null;uniqueIndex" json:"sessionId"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updatedAt"`
}

func (pu *PublicUser) BeforeCreate(tx *gorm.DB) error {
	if pu.ID == uuid.Nil {
		pu.ID = uuid.New()
	}
	return nil
}

func (pu *PublicUser) ToResponse() PublicUserResponse {
	return PublicUserResponse{
		ID:        pu.ID.String(),
		Name:      pu.Name,
		SessionID: pu.SessionID,
		CreatedAt: pu.CreatedAt,
	}
}

type PublicUserResponse struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	SessionID string    `json:"sessionId"`
	CreatedAt time.Time `json:"createdAt"`
}

type CreatePublicUserRequest struct {
	Name      string `json:"name" validate:"required,min=2,max=50"`
	SessionID string `json:"sessionId" validate:"required"`
}