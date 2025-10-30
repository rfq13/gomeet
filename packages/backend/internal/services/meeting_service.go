package services

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/filosofine/gomeet-backend/internal/cache"
	"github.com/filosofine/gomeet-backend/internal/models"
)

type MeetingService struct {
	db        *gorm.DB
	cacheRepo *cache.CacheRepository
}

type MeetingListResponse struct {
	Meetings   []models.MeetingResponse `json:"meetings"`
	Pagination models.PaginationInfo    `json:"pagination"`
}

func NewMeetingService(db *gorm.DB, cacheRepo *cache.CacheRepository) *MeetingService {
	return &MeetingService{
		db:        db,
		cacheRepo: cacheRepo,
	}
}

func (s *MeetingService) CreateMeeting(hostID uuid.UUID, req *models.CreateMeetingRequest) (*models.Meeting, error) {
	// Create meeting
	meeting := &models.Meeting{
		Name:      req.Name,
		StartTime: req.StartTime,
		HostID:    hostID,
	}

	// Start transaction
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Create meeting
	if err := tx.Create(meeting).Error; err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("failed to create meeting: %w", err)
	}

	// Create participants if provided
	if len(req.Participants) > 0 {
		for _, participantReq := range req.Participants {
			participant := &models.Participant{
				MeetingID: meeting.ID,
				Name:      participantReq.Name,
				AvatarURL: participantReq.AvatarURL,
			}
			if err := tx.Create(participant).Error; err != nil {
				tx.Rollback()
				return nil, fmt.Errorf("failed to create participant: %w", err)
			}
		}
	}

	// Commit transaction
	if err := tx.Commit().Error; err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	// Fetch meeting with relationships
	if err := s.db.Preload("Participants").Preload("Host").First(meeting, meeting.ID).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch created meeting: %w", err)
	}

	return meeting, nil
}

func (s *MeetingService) GetMeetings(hostID uuid.UUID, page, limit int, search string) (*MeetingListResponse, error) {
	// Try to get from cache first
	cacheKey := s.cacheRepo.GenerateMeetingListKey(hostID.String(), page, limit, search)
	meetingListResponse, found, err := s.cacheRepo.GetMeetingList(cacheKey)
	if err != nil {
		fmt.Printf("Cache error: %v\n", err)
	}
	
	if found {
		// Convert models.MeetingListResponse to MeetingListResponse
		meetingResponses := make([]models.MeetingResponse, len(meetingListResponse.Meetings))
		for i, meeting := range meetingListResponse.Meetings {
			meetingResponses[i] = meeting
		}
		
		return &MeetingListResponse{
			Meetings: meetingResponses,
			Pagination: meetingListResponse.Pagination,
		}, nil
	}

	// Cache miss, get from database
	var meetings []models.Meeting
	var total int64

	// Build query
	query := s.db.Model(&models.Meeting{}).Where("host_id = ?", hostID)

	// Add search filter if provided
	if search != "" {
		query = query.Where("name ILIKE ?", "%"+search+"%")
	}

	// Count total records
	if err := query.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("failed to count meetings: %w", err)
	}

	// Calculate pagination
	offset := (page - 1) * limit
	totalPages := int((total + int64(limit) - 1) / int64(limit))

	// Fetch meetings with relationships
	if err := query.Preload("Participants").Preload("Host").
		Offset(offset).Limit(limit).
		Order("start_time ASC").
		Find(&meetings).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch meetings: %w", err)
	}

	// Convert to response
	meetingResponses := make([]models.MeetingResponse, len(meetings))
	for i, meeting := range meetings {
		meetingResponses[i] = meeting.ToResponse()
	}

	response := &MeetingListResponse{
		Meetings: meetingResponses,
		Pagination: models.PaginationInfo{
			Page:       page,
			Limit:      limit,
			Total:      int(total),
			TotalPages: totalPages,
		},
	}

	// Cache the response - convert to models.MeetingListResponse for caching
	modelsResponse := &models.MeetingListResponse{
		Meetings: response.Meetings,
		Pagination: response.Pagination,
	}
	if err := s.cacheRepo.SetMeetingList(cacheKey, modelsResponse); err != nil {
		fmt.Printf("Failed to cache meeting list: %v\n", err)
	}

	return response, nil
}

func (s *MeetingService) GetMeetingByID(meetingID uuid.UUID, userID uuid.UUID) (*models.Meeting, error) {
	// Try to get from cache first
	meetingResponse, found, err := s.cacheRepo.GetMeetingDetails(meetingID.String())
	if err != nil {
		fmt.Printf("Cache error: %v\n", err)
	}
	
	if found {
		// Check if user is the host
		if meetingResponse.HostID != userID {
			return nil, errors.New("unauthorized access to meeting")
		}
		
		// Convert response back to model (simplified conversion)
		meeting := &models.Meeting{
			ID:        meetingResponse.ID,
			Name:      meetingResponse.Name,
			StartTime: meetingResponse.StartTime,
			HostID:    meetingResponse.HostID,
			IsActive:  meetingResponse.IsActive,
			CreatedAt: meetingResponse.CreatedAt,
		}
		return meeting, nil
	}

	// Cache miss, get from database
	var meeting models.Meeting

	// Fetch meeting with relationships
	if err := s.db.Preload("Participants").Preload("Host").
		Where("id = ?", meetingID).
		First(&meeting).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("meeting not found")
		}
		return nil, fmt.Errorf("failed to fetch meeting: %w", err)
	}

	// Check if user is the host
	if meeting.HostID != userID {
		return nil, errors.New("unauthorized access to meeting")
	}

	// Cache the meeting response
	meetingResponseCache := meeting.ToResponse()
	if err := s.cacheRepo.SetMeetingDetails(meetingID.String(), &meetingResponseCache); err != nil {
		fmt.Printf("Failed to cache meeting details: %v\n", err)
	}

	return &meeting, nil
}

func (s *MeetingService) GetMeetingByIDPublic(meetingID uuid.UUID) (*models.Meeting, error) {
	// Try to get from cache first
	meetingResponse, found, err := s.cacheRepo.GetMeetingDetails(meetingID.String())
	if err != nil {
		fmt.Printf("Cache error: %v\n", err)
	}
	
	if found {
		// Convert response back to model (simplified conversion)
		meeting := &models.Meeting{
			ID:        meetingResponse.ID,
			Name:      meetingResponse.Name,
			StartTime: meetingResponse.StartTime,
			HostID:    meetingResponse.HostID,
			IsActive:  meetingResponse.IsActive,
			CreatedAt: meetingResponse.CreatedAt,
		}
		return meeting, nil
	}

	// Cache miss, get from database
	var meeting models.Meeting

	// Fetch meeting with relationships (public access)
	if err := s.db.Preload("Participants").Preload("Host").
		Where("id = ?", meetingID).
		First(&meeting).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("meeting not found")
		}
		return nil, fmt.Errorf("failed to fetch meeting: %w", err)
	}

	// Cache the meeting response
	meetingResponseCache := meeting.ToResponse()
	if err := s.cacheRepo.SetMeetingDetails(meetingID.String(), &meetingResponseCache); err != nil {
		fmt.Printf("Failed to cache meeting details: %v\n", err)
	}

	return &meeting, nil
}

func (s *MeetingService) UpdateMeeting(meetingID uuid.UUID, userID uuid.UUID, req *models.UpdateMeetingRequest) (*models.Meeting, error) {
	// Check if meeting exists and user is the host
	var meeting models.Meeting
	if err := s.db.Where("id = ? AND host_id = ?", meetingID, userID).First(&meeting).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("meeting not found or unauthorized")
		}
		return nil, fmt.Errorf("failed to fetch meeting: %w", err)
	}

	// Start transaction
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Update meeting fields
	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.StartTime != nil {
		updates["start_time"] = *req.StartTime
	}

	if len(updates) > 0 {
		if err := tx.Model(&meeting).Updates(updates).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("failed to update meeting: %w", err)
		}
	}

	// Update participants if provided
	if req.Participants != nil {
		// Delete existing participants
		if err := tx.Where("meeting_id = ?", meetingID).Delete(&models.Participant{}).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("failed to delete existing participants: %w", err)
		}

		// Create new participants
		for _, participantReq := range *req.Participants {
			participant := &models.Participant{
				MeetingID: meetingID,
				Name:      participantReq.Name,
				AvatarURL: participantReq.AvatarURL,
			}
			if err := tx.Create(participant).Error; err != nil {
				tx.Rollback()
				return nil, fmt.Errorf("failed to create participant: %w", err)
			}
		}
	}

	// Commit transaction
	if err := tx.Commit().Error; err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	// Invalidate meeting-related cache
	if err := s.cacheRepo.InvalidateMeetingRelated(meetingID.String()); err != nil {
		fmt.Printf("Failed to invalidate meeting-related cache: %v\n", err)
	}

	// Fetch updated meeting with relationships
	if err := s.db.Preload("Participants").Preload("Host").First(&meeting, meetingID).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch updated meeting: %w", err)
	}

	return &meeting, nil
}

func (s *MeetingService) DeleteMeeting(meetingID uuid.UUID, userID uuid.UUID) error {
	// Check if meeting exists and user is the host
	var meeting models.Meeting
	if err := s.db.Where("id = ? AND host_id = ?", meetingID, userID).First(&meeting).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("meeting not found or unauthorized")
		}
		return fmt.Errorf("failed to fetch meeting: %w", err)
	}

	// Delete meeting (participants will be deleted due to cascade)
	if err := s.db.Delete(&meeting).Error; err != nil {
		return fmt.Errorf("failed to delete meeting: %w", err)
	}

	return nil
}

func (s *MeetingService) GetUpcomingMeetings(hostID uuid.UUID, limit int) ([]models.Meeting, error) {
	var meetings []models.Meeting

	// Fetch upcoming meetings
	if err := s.db.Preload("Participants").Preload("Host").
		Where("host_id = ? AND start_time > ?", hostID, time.Now()).
		Order("start_time ASC").
		Limit(limit).
		Find(&meetings).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch upcoming meetings: %w", err)
	}

	return meetings, nil
}

func (s *MeetingService) GetPastMeetings(hostID uuid.UUID, page, limit int) (*MeetingListResponse, error) {
	var meetings []models.Meeting
	var total int64

	// Build query
	query := s.db.Model(&models.Meeting{}).
		Where("host_id = ? AND start_time < ?", hostID, time.Now())

	// Count total records
	if err := query.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("failed to count past meetings: %w", err)
	}

	// Calculate pagination
	offset := (page - 1) * limit
	totalPages := int((total + int64(limit) - 1) / int64(limit))

	// Fetch meetings with relationships
	if err := query.Preload("Participants").Preload("Host").
		Offset(offset).Limit(limit).
		Order("start_time DESC").
		Find(&meetings).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch past meetings: %w", err)
	}

	// Convert to response
	meetingResponses := make([]models.MeetingResponse, len(meetings))
	for i, meeting := range meetings {
		meetingResponses[i] = meeting.ToResponse()
	}

	return &MeetingListResponse{
		Meetings: meetingResponses,
		Pagination: models.PaginationInfo{
			Page:       page,
			Limit:      limit,
			Total:      int(total),
			TotalPages: totalPages,
		},
	}, nil
}

func (s *MeetingService) JoinMeeting(userID uuid.UUID, meetingID uuid.UUID) (*models.Participant, error) {
	// Check if meeting exists
	var meeting models.Meeting
	if err := s.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("meeting not found")
		}
		return nil, fmt.Errorf("failed to fetch meeting: %w", err)
	}

	// Check if user is already a participant
	var existingParticipant models.Participant
	if err := s.db.Where("meeting_id = ? AND user_id = ?", meetingID, userID).First(&existingParticipant).Error; err == nil {
		return &existingParticipant, nil // Already joined
	}

	// Get user info
	var user models.User
	if err := s.db.Where("id = ?", userID).First(&user).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch user: %w", err)
	}

	// Create participant
	participant := &models.Participant{
		MeetingID: meetingID,
		UserID:    &userID,
		Name:      user.Username,
		AvatarURL: user.AvatarURL,
		IsActive:  true,
	}

	if err := s.db.Create(participant).Error; err != nil {
		return nil, fmt.Errorf("failed to join meeting: %w", err)
	}

	// Invalidate participant list cache
	if err := s.cacheRepo.InvalidateParticipantList(meetingID.String()); err != nil {
		fmt.Printf("Failed to invalidate participant list cache: %v\n", err)
	}

	return participant, nil
}

func (s *MeetingService) LeaveMeeting(userID uuid.UUID, meetingID uuid.UUID) error {
	// Check if participant exists
	var participant models.Participant
	if err := s.db.Where("meeting_id = ? AND user_id = ?", meetingID, userID).First(&participant).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("meeting not found")
		}
		return fmt.Errorf("failed to fetch participant: %w", err)
	}

	// Update participant to inactive
	if err := s.db.Model(&participant).Updates(map[string]interface{}{
		"is_active": false,
		"left_at":   time.Now(),
	}).Error; err != nil {
		return fmt.Errorf("failed to leave meeting: %w", err)
	}

	// Invalidate participant list cache
	if err := s.cacheRepo.InvalidateParticipantList(meetingID.String()); err != nil {
		fmt.Printf("Failed to invalidate participant list cache: %v\n", err)
	}

	return nil
}

func (s *MeetingService) GetMeetingParticipants(meetingID uuid.UUID, userID uuid.UUID) ([]models.Participant, error) {
	// Try to get from cache first
	participantResponses, found, err := s.cacheRepo.GetParticipantList(meetingID.String())
	if err != nil {
		fmt.Printf("Cache error: %v\n", err)
	}
	
	if found {
		// Convert responses back to models (simplified conversion)
		participants := make([]models.Participant, len(participantResponses))
		for i, resp := range participantResponses {
			participants[i] = models.Participant{
				ID:           resp.ID,
				UserID:       resp.UserID,
				PublicUserID: resp.PublicUserID,
				Name:         resp.Name,
				AvatarURL:    resp.AvatarURL,
				IsActive:     resp.IsActive,
				JoinedAt:     resp.JoinedAt,
				LeftAt:       resp.LeftAt,
			}
		}
		return participants, nil
	}

	// Cache miss, get from database
	// Check if meeting exists and user has access (either host or participant)
	var meeting models.Meeting
	if err := s.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("meeting not found")
		}
		return nil, fmt.Errorf("failed to fetch meeting: %w", err)
	}

	// Check if user is host or participant
	var participantCount int64
	s.db.Model(&models.Participant{}).Where("meeting_id = ? AND user_id = ?", meetingID, userID).Count(&participantCount)
	
	if meeting.HostID != userID && participantCount == 0 {
		return nil, errors.New("unauthorized access to meeting")
	}

	// Get participants
	var participants []models.Participant
	if err := s.db.Where("meeting_id = ? AND is_active = ?", meetingID, true).
		Order("joined_at ASC").
		Find(&participants).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch participants: %w", err)
	}

	// Cache the participant responses
	participantResponses = make([]models.ParticipantResponse, len(participants))
	for i, participant := range participants {
		participantResponses[i] = participant.ToResponse()
	}
	
	if err := s.cacheRepo.SetParticipantList(meetingID.String(), participantResponses); err != nil {
		fmt.Printf("Failed to cache participant list: %v\n", err)
	}

	return participants, nil
}

func (s *MeetingService) GetMeetingParticipantsPublic(meetingID uuid.UUID) ([]models.Participant, error) {
	// Check if meeting exists
	var meeting models.Meeting
	if err := s.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("meeting not found")
		}
		return nil, fmt.Errorf("failed to fetch meeting: %w", err)
	}

	// Get all active participants (both authenticated and public users)
	var participants []models.Participant
	if err := s.db.Where("meeting_id = ? AND is_active = ?", meetingID, true).
		Preload("User").
		Preload("PublicUser").
		Order("joined_at ASC").
		Find(&participants).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch participants: %w", err)
	}

	return participants, nil
}

func (s *MeetingService) GetJoinedMeetings(userID uuid.UUID, page, limit int) (*MeetingListResponse, error) {
	var meetings []models.Meeting
	var total int64

	// Build query - get meetings where user is a participant
	query := s.db.Model(&models.Meeting{}).
		Joins("INNER JOIN participants ON meetings.id = participants.meeting_id").
		Where("participants.user_id = ? AND participants.is_active = ?", userID, true)

	// Count total records
	if err := query.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("failed to count joined meetings: %w", err)
	}

	// Calculate pagination
	offset := (page - 1) * limit
	totalPages := int((total + int64(limit) - 1) / int64(limit))

	// Fetch meetings with relationships
	if err := query.Preload("Participants").Preload("Host").
		Offset(offset).Limit(limit).
		Order("meetings.start_time ASC").
		Find(&meetings).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch joined meetings: %w", err)
	}

	// Convert to response
	meetingResponses := make([]models.MeetingResponse, len(meetings))
	for i, meeting := range meetings {
		meetingResponses[i] = meeting.ToResponse()
	}

	return &MeetingListResponse{
		Meetings: meetingResponses,
		Pagination: models.PaginationInfo{
			Page:       page,
			Limit:      limit,
			Total:      int(total),
			TotalPages: totalPages,
		},
	}, nil
}

func (s *MeetingService) StartMeeting(meetingID uuid.UUID, userID uuid.UUID) (*models.Meeting, error) {
	// Check if meeting exists and user is the host
	var meeting models.Meeting
	if err := s.db.Where("id = ? AND host_id = ?", meetingID, userID).First(&meeting).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("meeting not found or unauthorized")
		}
		return nil, fmt.Errorf("failed to fetch meeting: %w", err)
	}

	// Update meeting to active
	if err := s.db.Model(&meeting).Updates(map[string]interface{}{
		"is_active": true,
	}).Error; err != nil {
		return nil, fmt.Errorf("failed to start meeting: %w", err)
	}

	// Fetch updated meeting with relationships
	if err := s.db.Preload("Participants").Preload("Host").First(&meeting, meetingID).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch updated meeting: %w", err)
	}

	return &meeting, nil
}

func (s *MeetingService) EndMeeting(meetingID uuid.UUID, userID uuid.UUID) (*models.Meeting, error) {
	// Check if meeting exists and user is the host
	var meeting models.Meeting
	if err := s.db.Where("id = ? AND host_id = ?", meetingID, userID).First(&meeting).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("meeting not found or unauthorized")
		}
		return nil, fmt.Errorf("failed to fetch meeting: %w", err)
	}

	// Update meeting to inactive
	if err := s.db.Model(&meeting).Updates(map[string]interface{}{
		"is_active": false,
	}).Error; err != nil {
		return nil, fmt.Errorf("failed to end meeting: %w", err)
	}

	// Deactivate all participants
	if err := s.db.Model(&models.Participant{}).Where("meeting_id = ?", meetingID).Updates(map[string]interface{}{
		"is_active": false,
		"left_at":   time.Now(),
	}).Error; err != nil {
		return nil, fmt.Errorf("failed to deactivate participants: %w", err)
	}

	// Fetch updated meeting with relationships
	if err := s.db.Preload("Participants").Preload("Host").First(&meeting, meetingID).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch updated meeting: %w", err)
	}

	return &meeting, nil
}