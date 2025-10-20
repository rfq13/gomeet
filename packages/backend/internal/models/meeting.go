package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Meeting struct {
	ID        uuid.UUID      `gorm:"type:uuid;primary_key" json:"id"`
	Name      string         `gorm:"not null;size:255" json:"name" validate:"required,min=1,max=255"`
	StartTime time.Time      `gorm:"not null" json:"startTime"`
	HostID    uuid.UUID      `gorm:"type:uuid;not null" json:"hostId"`
	IsActive  bool           `gorm:"default:false" json:"isActive"`
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updatedAt"`

	// Relationships
	Host         User         `gorm:"foreignKey:HostID" json:"host,omitempty"`
	Participants []Participant `gorm:"foreignKey:MeetingID" json:"participants,omitempty"`
}

type MeetingResponse struct {
	ID           uuid.UUID    `json:"id"`
	Name         string       `json:"name"`
	StartTime    time.Time    `json:"startTime"`
	HostID       uuid.UUID    `json:"hostId"`
	IsActive     bool         `json:"isActive"`
	Host         UserResponse `json:"host,omitempty"`
	Participants []ParticipantResponse `json:"participants,omitempty"`
	CreatedAt    time.Time    `json:"createdAt"`
}

type CreateMeetingRequest struct {
	Name         string                    `json:"name" validate:"required,min=1,max=255"`
	StartTime    time.Time                 `json:"startTime" validate:"required"`
	Participants []CreateParticipantRequest `json:"participants,omitempty"`
}

type UpdateMeetingRequest struct {
	Name         *string                   `json:"name,omitempty" validate:"omitempty,min=1,max=255"`
	StartTime    *time.Time                `json:"startTime,omitempty"`
	Participants *[]CreateParticipantRequest `json:"participants,omitempty"`
}

type JoinMeetingRequest struct {
	MeetingID uuid.UUID `json:"meetingId" validate:"required"`
}

type LeaveMeetingRequest struct {
	MeetingID uuid.UUID `json:"meetingId" validate:"required"`
}

type MeetingListResponse struct {
	Meetings   []MeetingResponse `json:"meetings"`
	Pagination PaginationInfo    `json:"pagination"`
}

type PaginationInfo struct {
	Page       int `json:"page"`
	Limit      int `json:"limit"`
	Total      int `json:"total"`
	TotalPages int `json:"totalPages"`
}

func (m *Meeting) ToResponse() MeetingResponse {
	response := MeetingResponse{
		ID:        m.ID,
		Name:      m.Name,
		StartTime: m.StartTime,
		HostID:    m.HostID,
		IsActive:  m.IsActive,
		CreatedAt: m.CreatedAt,
	}

	if m.Host.ID != uuid.Nil {
		response.Host = m.Host.ToResponse()
	}

	for _, participant := range m.Participants {
		response.Participants = append(response.Participants, participant.ToResponse())
	}

	return response
}

// BeforeCreate hook to generate UUID
func (m *Meeting) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}