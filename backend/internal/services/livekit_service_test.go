package services

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/your-org/gomeet-backend/internal/models"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)

	// Migrate all tables
	err = db.AutoMigrate(
		&models.User{},
		&models.Meeting{},
		&models.Participant{},
		&LiveKitRoom{},
		&LiveKitParticipant{},
	)
	require.NoError(t, err)

	return db
}

func createTestUser(t *testing.T, db *gorm.DB) *models.User {
	user := &models.User{
		Username:     "testuser",
		Email:        "test@example.com",
		PasswordHash: "hashedpassword",
	}

	err := db.Create(user).Error
	require.NoError(t, err)

	return user
}

func createTestMeeting(t *testing.T, db *gorm.DB, userID uuid.UUID) *models.Meeting {
	meeting := &models.Meeting{
		Name:      "Test Meeting",
		StartTime: time.Now().Add(1 * time.Hour),
		HostID:    userID,
		IsActive:  true,
	}

	err := db.Create(meeting).Error
	require.NoError(t, err)

	return meeting
}

func createTestParticipant(t *testing.T, db *gorm.DB, meetingID, userID uuid.UUID) *models.Participant {
	participant := &models.Participant{
		MeetingID: meetingID,
		UserID:    &userID,
		Name:      "Test Participant",
		IsActive:  true,
	}

	err := db.Create(participant).Error
	require.NoError(t, err)

	return participant
}

func TestLiveKitService_CreateRoom(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)

	logger := logrus.New()
	service := &LiveKitService{
		config: LiveKitConfig{
			APIKey:    "test-api-key",
			APISecret: "test-api-secret",
			Host:      "localhost:7880",
		},
		db:     db,
		logger: logger,
	}

	// Test creating room
	err := service.CreateRoom(meeting.ID)
	assert.NoError(t, err)

	// Verify room was created in database
	var liveKitRoom LiveKitRoom
	err = db.Where("meeting_id = ?", meeting.ID).First(&liveKitRoom).Error
	assert.NoError(t, err)
	assert.Equal(t, meeting.ID, liveKitRoom.MeetingID)
	assert.NotEmpty(t, liveKitRoom.LiveKitRoomID)
}

func TestLiveKitService_GenerateToken(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)
	participant := createTestParticipant(t, db, meeting.ID, user.ID)

	logger := logrus.New()
	service := &LiveKitService{
		config: LiveKitConfig{
			APIKey:    "test-api-key",
			APISecret: "test-api-secret",
			Host:      "localhost:7880",
		},
		db:     db,
		logger: logger,
	}

	// First create the room
	err := service.CreateRoom(meeting.ID)
	require.NoError(t, err)

	// Generate token
	token, err := service.GenerateToken(participant.ID, meeting.ID)
	assert.NoError(t, err)
	assert.NotEmpty(t, token)
}

func TestLiveKitService_JoinRoom(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)
	participant := createTestParticipant(t, db, meeting.ID, user.ID)

	logger := logrus.New()
	service := &LiveKitService{
		config: LiveKitConfig{
			APIKey:    "test-api-key",
			APISecret: "test-api-secret",
			Host:      "localhost:7880",
		},
		db:     db,
		logger: logger,
	}

	// First create the room
	err := service.CreateRoom(meeting.ID)
	require.NoError(t, err)

	// Join room
	err = service.JoinRoom(participant.ID, meeting.ID)
	assert.NoError(t, err)

	// Verify participant was added to LiveKit participants table
	var liveKitParticipant LiveKitParticipant
	err = db.Where("meeting_id = ? AND participant_id = ?", meeting.ID, participant.ID).First(&liveKitParticipant).Error
	assert.NoError(t, err)
	assert.Equal(t, meeting.ID, liveKitParticipant.MeetingID)
	assert.Equal(t, participant.ID, liveKitParticipant.ParticipantID)
	assert.True(t, liveKitParticipant.IsActive)
}

func TestLiveKitService_LeaveRoom(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)
	participant := createTestParticipant(t, db, meeting.ID, user.ID)

	logger := logrus.New()
	service := &LiveKitService{
		config: LiveKitConfig{
			APIKey:    "test-api-key",
			APISecret: "test-api-secret",
			Host:      "localhost:7880",
		},
		db:     db,
		logger: logger,
	}

	// First create the room and join
	err := service.CreateRoom(meeting.ID)
	require.NoError(t, err)

	err = service.JoinRoom(participant.ID, meeting.ID)
	require.NoError(t, err)

	// Leave room
	err = service.LeaveRoom(participant.ID, meeting.ID)
	assert.NoError(t, err)

	// Verify participant is marked as inactive
	var liveKitParticipant LiveKitParticipant
	err = db.Where("meeting_id = ? AND participant_id = ?", meeting.ID, participant.ID).First(&liveKitParticipant).Error
	assert.NoError(t, err)
	assert.False(t, liveKitParticipant.IsActive)
	assert.NotNil(t, liveKitParticipant.LeftAt)
}

func TestLiveKitService_DeleteRoom(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)

	logger := logrus.New()
	service := &LiveKitService{
		config: LiveKitConfig{
			APIKey:    "test-api-key",
			APISecret: "test-api-secret",
			Host:      "localhost:7880",
		},
		db:     db,
		logger: logger,
	}

	// First create the room
	err := service.CreateRoom(meeting.ID)
	require.NoError(t, err)

	// Delete room
	err = service.DeleteRoom(meeting.ID)
	assert.NoError(t, err)

	// Verify room was deleted from database
	var liveKitRoom LiveKitRoom
	err = db.Where("meeting_id = ?", meeting.ID).First(&liveKitRoom).Error
	assert.Error(t, err) // Should not find the room
	assert.Equal(t, gorm.ErrRecordNotFound, err)
}

func TestLiveKitService_GetParticipantCount(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)
	participant := createTestParticipant(t, db, meeting.ID, user.ID)

	logger := logrus.New()
	service := &LiveKitService{
		config: LiveKitConfig{
			APIKey:    "test-api-key",
			APISecret: "test-api-secret",
			Host:      "localhost:7880",
		},
		db:     db,
		logger: logger,
	}

	// First create the room and join
	err := service.CreateRoom(meeting.ID)
	require.NoError(t, err)

	err = service.JoinRoom(participant.ID, meeting.ID)
	require.NoError(t, err)

	// Get participant count
	count, err := service.GetParticipantCount(meeting.ID)
	assert.NoError(t, err)
	assert.Equal(t, 1, count)
}

func TestLiveKitService_GetActiveParticipants(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)
	participant := createTestParticipant(t, db, meeting.ID, user.ID)

	logger := logrus.New()
	service := &LiveKitService{
		config: LiveKitConfig{
			APIKey:    "test-api-key",
			APISecret: "test-api-secret",
			Host:      "localhost:7880",
		},
		db:     db,
		logger: logger,
	}

	// First create the room and join
	err := service.CreateRoom(meeting.ID)
	require.NoError(t, err)

	err = service.JoinRoom(participant.ID, meeting.ID)
	require.NoError(t, err)

	// Get active participants
	participants, err := service.GetParticipants(meeting.ID)
	assert.NoError(t, err)
	assert.Len(t, participants, 1)
	assert.Equal(t, participant.ID, participants[0].ParticipantID)
}

// Benchmark tests
func BenchmarkLiveKitService_CreateRoom(b *testing.B) {
	db := setupTestDB(&testing.T{})
	user := createTestUser(&testing.T{}, db)

	logger := logrus.New()
	service := &LiveKitService{
		config: LiveKitConfig{
			APIKey:    "test-api-key",
			APISecret: "test-api-secret",
			Host:      "localhost:7880",
		},
		db:     db,
		logger: logger,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		meeting := createTestMeeting(&testing.T{}, db, user.ID)
		err := service.CreateRoom(meeting.ID)
		if err != nil {
			b.Fatalf("Failed to create room: %v", err)
		}
	}
}

func BenchmarkLiveKitService_GenerateToken(b *testing.B) {
	db := setupTestDB(&testing.T{})
	user := createTestUser(&testing.T{}, db)
	meeting := createTestMeeting(&testing.T{}, db, user.ID)
	participant := createTestParticipant(&testing.T{}, db, meeting.ID, user.ID)

	logger := logrus.New()
	service := &LiveKitService{
		config: LiveKitConfig{
			APIKey:    "test-api-key",
			APISecret: "test-api-secret",
			Host:      "localhost:7880",
		},
		db:     db,
		logger: logger,
	}

	// Create room first
	err := service.CreateRoom(meeting.ID)
	if err != nil {
		b.Fatalf("Failed to create room: %v", err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := service.GenerateToken(participant.ID, meeting.ID)
		if err != nil {
			b.Fatalf("Failed to generate token: %v", err)
		}
	}
}

func BenchmarkLiveKitService_JoinRoom(b *testing.B) {
	db := setupTestDB(&testing.T{})
	user := createTestUser(&testing.T{}, db)

	logger := logrus.New()
	service := &LiveKitService{
		config: LiveKitConfig{
			APIKey:    "test-api-key",
			APISecret: "test-api-secret",
			Host:      "localhost:7880",
		},
		db:     db,
		logger: logger,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		meeting := createTestMeeting(&testing.T{}, db, user.ID)
		participant := createTestParticipant(&testing.T{}, db, meeting.ID, user.ID)
		
		// Create room first
		err := service.CreateRoom(meeting.ID)
		if err != nil {
			b.Fatalf("Failed to create room: %v", err)
		}
		
		err = service.JoinRoom(participant.ID, meeting.ID)
		if err != nil {
			b.Fatalf("Failed to join room: %v", err)
		}
	}
}