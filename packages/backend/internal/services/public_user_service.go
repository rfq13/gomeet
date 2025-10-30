package services

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/filosofine/gomeet-backend/internal/cache"
	"github.com/filosofine/gomeet-backend/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type PublicUserService struct {
	db        *gorm.DB
	cacheRepo *cache.CacheRepository
}

func NewPublicUserService(db *gorm.DB, cacheRepo *cache.CacheRepository) *PublicUserService {
	return &PublicUserService{
		db:        db,
		cacheRepo: cacheRepo,
	}
}

func (s *PublicUserService) CreatePublicUser(req *models.CreatePublicUserRequest) (*models.PublicUser, error) {
	// Check if public user with this session ID already exists
	var existingUser models.PublicUser
	if err := s.db.Where("session_id = ?", req.SessionID).First(&existingUser).Error; err == nil {
		// User already exists, cache and return existing user
		publicUserResponse := existingUser.ToResponse()
		if cacheErr := s.cacheRepo.SetPublicUser(req.SessionID, &publicUserResponse); cacheErr != nil {
			fmt.Printf("Failed to cache existing public user: %v\n", cacheErr)
		}
		return &existingUser, nil
	}

	// Create new public user with provided session ID
	publicUser := &models.PublicUser{
		Name:      req.Name,
		SessionID: req.SessionID,
	}

	if err := s.db.Create(publicUser).Error; err != nil {
		return nil, fmt.Errorf("failed to create public user: %w", err)
	}

	// Cache the new public user
	publicUserResponse := publicUser.ToResponse()
	if err := s.cacheRepo.SetPublicUser(req.SessionID, &publicUserResponse); err != nil {
		fmt.Printf("Failed to cache new public user: %v\n", err)
	}

	return publicUser, nil
}

func (s *PublicUserService) GetPublicUserBySessionID(sessionID string) (*models.PublicUser, error) {
	// Try to get from cache first
	publicUserResponse, found, err := s.cacheRepo.GetPublicUser(sessionID)
	if err != nil {
		fmt.Printf("Cache error: %v\n", err)
	}
	
	if found {
		// Convert response back to model
		publicUser := &models.PublicUser{
			ID:        uuid.MustParse(publicUserResponse.ID),
			Name:      publicUserResponse.Name,
			SessionID: publicUserResponse.SessionID,
			CreatedAt: publicUserResponse.CreatedAt,
		}
		return publicUser, nil
	}

	// Cache miss, get from database
	var publicUser models.PublicUser

	if err := s.db.Where("session_id = ?", sessionID).First(&publicUser).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("public user not found")
		}
		return nil, fmt.Errorf("failed to fetch public user: %w", err)
	}

	// Cache the public user response
	publicUserResponseCache := publicUser.ToResponse()
	if err := s.cacheRepo.SetPublicUser(sessionID, &publicUserResponseCache); err != nil {
		fmt.Printf("Failed to cache public user: %v\n", err)
	}

	return &publicUser, nil
}

func (s *PublicUserService) JoinMeetingAsPublicUser(sessionID string, meetingID uuid.UUID) (*models.Participant, error) {
	// Get public user
	publicUser, err := s.GetPublicUserBySessionID(sessionID)
	if err != nil {
		return nil, err
	}

	// Check if meeting exists
	var meeting models.Meeting
	if err := s.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("meeting not found")
		}
		return nil, fmt.Errorf("failed to fetch meeting: %w", err)
	}

	// Check if public user is already a participant
	var existingParticipant models.Participant
	if err := s.db.Where("meeting_id = ? AND public_user_id = ?", meetingID, publicUser.ID).First(&existingParticipant).Error; err == nil {
		if existingParticipant.IsActive {
			return &existingParticipant, nil // Already joined and active
		}
		// Reactivate existing participant
		if err := s.db.Model(&existingParticipant).Updates(map[string]interface{}{
			"is_active": true,
			"left_at":   nil,
		}).Error; err != nil {
			return nil, fmt.Errorf("failed to reactivate participant: %w", err)
		}
		return &existingParticipant, nil
	}

	// Create new participant
	participant := &models.Participant{
		MeetingID:    meetingID,
		PublicUserID: &publicUser.ID,
		Name:         publicUser.Name,
		IsActive:     true,
	}

	if err := s.db.Create(participant).Error; err != nil {
		return nil, fmt.Errorf("failed to join meeting: %w", err)
	}

	return participant, nil
}

func (s *PublicUserService) LeaveMeetingAsPublicUser(sessionID string, meetingID uuid.UUID) error {
	// Get public user
	publicUser, err := s.GetPublicUserBySessionID(sessionID)
	if err != nil {
		return err
	}

	// Check if participant exists
	var participant models.Participant
	if err := s.db.Where("meeting_id = ? AND public_user_id = ?", meetingID, publicUser.ID).First(&participant).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("participant not found")
		}
		return fmt.Errorf("failed to fetch participant: %w", err)
	}

	// Update participant to inactive
	if err := s.db.Model(&participant).Updates(map[string]interface{}{
		"is_active": false,
		"left_at":   gorm.Expr("NOW()"),
	}).Error; err != nil {
		return fmt.Errorf("failed to leave meeting: %w", err)
	}

	return nil
}

// generateSessionID generates a random session ID
func generateSessionID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}