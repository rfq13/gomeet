package services

// TEMPORARILY DISABLED FOR EMERGENCY WEBSOCKET FIX
// import (
// 	"context"
// 	"fmt"
// 	"time"

// 	"github.com/golang-jwt/jwt/v5"
// 	"github.com/google/uuid"
// 	"github.com/redis/go-redis/v9"
// 	"github.com/sirupsen/logrus"
// 	"gorm.io/gorm"

// 	"github.com/livekit/protocol/livekit"
// 	lksdk "github.com/livekit/server-sdk-go"
// )

// TEMPORARILY DISABLED FOR EMERGENCY WEBSOCKET FIX
// All LiveKit functionality disabled to resolve compilation issues
// This will be re-enabled once WebSocket client explosion is fixed

// type LiveKitService struct {
// 	roomClient *lksdk.RoomServiceClient
// 	redis      *redis.Client
// 	db         *gorm.DB
// 	logger     *logrus.Logger
// 	config     LiveKitConfig
// }

// type LiveKitConfig struct {
// 	Host        string
// 	APIKey      string
// 	APISecret   string
// 	RedisAddr   string
// 	RedisPassword string
// }

// type LiveKitRoom struct {
// 	ID            uuid.UUID `gorm:"primaryKey;type:uuid;default:gen_random_uuid()"`
// 	MeetingID     uuid.UUID `gorm:"type:uuid;not null;index"`
// 	LiveKitRoomID string    `gorm:"size:255;not null;unique"`
// 	CreatedAt     time.Time `gorm:"autoCreateTime"`
// 	UpdatedAt     time.Time `gorm:"autoUpdateTime"`
// }

// type LiveKitParticipant struct {
// 	ID                  uuid.UUID `gorm:"primaryKey;type:uuid;default:gen_random_uuid()"`
// 	MeetingID           uuid.UUID `gorm:"type:uuid;not null;index"`
// 	ParticipantID       uuid.UUID `gorm:"type:uuid;not null;index"`
// 	LiveKitParticipantID string   `gorm:"size:255;not null"`
// 	JoinedAt            time.Time `gorm:"autoCreateTime"`
// 	LeftAt             *time.Time
// 	IsActive           bool      `gorm:"default:true"`
// }

// type VideoGrant struct {
// 	RoomJoin    bool   `json:"roomJoin"`
// 	Room        string `json:"room"`
// 	RoomAdmin   bool   `json:"roomAdmin"`
// 	RoomRecord  bool   `json:"roomRecord"`
// }

// type AccessTokenClaims struct {
// 	VideoGrant VideoGrant `json:"video"`
// 	Name       string     `json:"name"`
// 	Identity   string     `json:"identity"`
// 	jwt.RegisteredClaims
// }

// func NewLiveKitService(config LiveKitConfig, redisClient *redis.Client, db *gorm.DB) (*LiveKitService, error) {
// 	logger := logrus.New()
// 	logger.SetLevel(logrus.InfoLevel)

// 	// Create LiveKit room service client
// 	roomClient := lksdk.NewRoomServiceClient(config.Host, config.APIKey, config.APISecret)

// 	service := &LiveKitService{
// 		roomClient: roomClient,
// 		redis:      redisClient,
// 		db:         db,
// 		logger:     logger,
// 		config:     config,
// 	}

// 	// Auto-migrate database tables
// 	if err := db.AutoMigrate(&LiveKitRoom{}, &LiveKitParticipant{}); err != nil {
// 		return nil, fmt.Errorf("failed to migrate LiveKit tables: %w", err)
// 	}

// 	return service, nil
// }

// // CreateRoom creates a new LiveKit room for a meeting
// func (s *LiveKitService) CreateRoom(meetingID uuid.UUID) error {
// 	ctx := context.Background()

// 	// Generate unique room name
// 	roomName := fmt.Sprintf("meeting_%s", meetingID.String())

// 	// Create room in LiveKit
// 	room := &livekit.Room{
// 		Name:            roomName,
// 		EmptyTimeout:    300, // 5 minutes
// 		MaxParticipants: 50,
// 		EnabledCodecs: []*livekit.Codec{
// 			{
// 				Mime:   "video/vp8",
// 				Cid:    "vp8",
// 			},
// 			{
// 				Mime:   "video/h264",
// 				Cid:    "h264",
// 			},
// 			{
// 				Mime:   "audio/opus",
// 				Cid:    "opus",
// 			},
// 		},
// 	}

// 	_, err := s.roomClient.CreateRoom(ctx, room)
// 	if err != nil {
// 		s.logger.WithError(err).WithField("meeting_id", meetingID).Error("Failed to create LiveKit room")
// 		return fmt.Errorf("failed to create LiveKit room: %w", err)
// 	}

// 	// Save room to database
// 	liveKitRoom := &LiveKitRoom{
// 		MeetingID:     meetingID,
// 		LiveKitRoomID: roomName,
// 	}

// 	if err := s.db.Create(liveKitRoom).Error; err != nil {
// 		s.logger.WithError(err).WithField("meeting_id", meetingID).Error("Failed to save LiveKit room to database")
// 		// Try to cleanup LiveKit room
// 		_, _ = s.roomClient.DeleteRoom(ctx, &livekit.DeleteRoomRequest{
// 			Room: roomName,
// 		})
// 		return fmt.Errorf("failed to save LiveKit room to database: %w", err)
// 	}

// 	s.logger.WithFields(logrus.Fields{
// 		"meeting_id":      meetingID,
// 		"livekit_room_id": roomName,
// 	}).Info("LiveKit room created successfully")

// 	return nil
// }

// // GenerateToken generates a JWT token for participant to join LiveKit room
// func (s *LiveKitService) GenerateToken(participantID, meetingID uuid.UUID) (string, error) {
// 	ctx := context.Background()

// 	// Get LiveKit room from database
// 	var liveKitRoom LiveKitRoom
// 	if err := s.db.Where("meeting_id = ?", meetingID).First(&liveKitRoom).Error; err != nil {
// 		if err == gorm.ErrRecordNotFound {
// 			// Create room if not exists
// 			if err := s.CreateRoom(meetingID); err != nil {
// 				return "", fmt.Errorf("failed to create room for token generation: %w", err)
// 			}
// 			// Retry getting room
// 			if err := s.db.Where("meeting_id = ?", meetingID).First(&liveKitRoom).Error; err != nil {
// 				return "", fmt.Errorf("failed to get LiveKit room after creation: %w", err)
// 			}
// 		} else {
// 			return "", fmt.Errorf("failed to get LiveKit room: %w", err)
// 		}
// 	}

// 	// Generate participant identity
// 	participantIdentity := fmt.Sprintf("user_%s", participantID.String())

// 	// For now, use simple JWT token generation
// 	// TODO: Replace with actual LiveKit SDK token generation once dependencies are resolved
// 	grant := VideoGrant{
// 		RoomJoin: true,
// 		Room:     liveKitRoom.LiveKitRoomID,
// 		RoomAdmin: true,
// 		RoomRecord: true,
// 	}

// 	// Create JWT token
// 	claims := AccessTokenClaims{
// 		VideoGrant: grant,
// 		Name:       participantIdentity,
// 		Identity:   participantIdentity,
// 		RegisteredClaims: jwt.RegisteredClaims{
// 			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
// 			IssuedAt:  jwt.NewNumericDate(time.Now()),
// 			NotBefore: jwt.NewNumericDate(time.Now()),
// 			Issuer:    "gomeet-backend",
// 			Subject:   participantIdentity,
// 		},
// 	}

// 	jwtToken := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
// 	token, err := jwtToken.SignedString([]byte(s.config.APISecret))
// 	if err != nil {
// 		s.logger.WithError(err).WithFields(logrus.Fields{
// 			"participant_id": participantID,
// 			"meeting_id":     meetingID,
// 		}).Error("Failed to generate LiveKit token")
// 		return "", fmt.Errorf("failed to generate LiveKit token: %w", err)
// 	}

// 	// Cache token in Redis for quick lookup
// 	tokenKey := fmt.Sprintf("livekit_token:%s:%s", meetingID.String(), participantID.String())
// 	if err := s.redis.Set(ctx, tokenKey, token, 24*time.Hour).Err(); err != nil {
// 		s.logger.WithError(err).Warn("Failed to cache token in Redis")
// 		// Don't fail the operation if Redis fails
// 	}

// 	s.logger.WithFields(logrus.Fields{
// 		"participant_id": participantID,
// 		"meeting_id":     meetingID,
// 		"room_id":        liveKitRoom.LiveKitRoomID,
// 	}).Info("LiveKit token generated successfully")

// 	return token, nil
// }

// // JoinRoom handles participant joining a LiveKit room
// func (s *LiveKitService) JoinRoom(participantID, meetingID uuid.UUID) error {
// 	ctx := context.Background()

// 	// Get LiveKit room
// 	var liveKitRoom LiveKitRoom
// 	if err := s.db.Where("meeting_id = ?", meetingID).First(&liveKitRoom).Error; err != nil {
// 		return fmt.Errorf("failed to get LiveKit room: %w", err)
// 	}

// 	// Check if participant already exists
// 	var existingParticipant LiveKitParticipant
// 	err := s.db.Where("meeting_id = ? AND participant_id = ?", meetingID, participantID).First(&existingParticipant).Error
// 	if err == nil && existingParticipant.IsActive {
// 		// Participant already joined and active
// 		s.logger.WithFields(logrus.Fields{
// 			"participant_id": participantID,
// 			"meeting_id":     meetingID,
// 		}).Info("Participant already joined room")
// 		return nil
// 	}

// 	// Create participant record
// 	liveKitParticipant := &LiveKitParticipant{
// 		MeetingID:           meetingID,
// 		ParticipantID:       participantID,
// 		LiveKitParticipantID: fmt.Sprintf("user_%s", participantID.String()),
// 		IsActive:            true,
// 	}

// 	if err := s.db.Create(liveKitParticipant).Error; err != nil {
// 		return fmt.Errorf("failed to create participant record: %w", err)
// 	}

// 	// Update participant count in Redis
// 	participantCountKey := fmt.Sprintf("livekit_participants:%s", meetingID.String())
// 	count, err := s.redis.Incr(ctx, participantCountKey).Result()
// 	if err != nil {
// 		s.logger.WithError(err).Warn("Failed to update participant count in Redis")
// 	} else {
// 		// Set expiry for participant count
// 		s.redis.Expire(ctx, participantCountKey, 24*time.Hour)
// 		s.logger.WithFields(logrus.Fields{
// 			"meeting_id":        meetingID,
// 			"participant_count": count,
// 		}).Info("Participant joined room")
// 	}

// 	return nil
// }

// // LeaveRoom handles participant leaving a LiveKit room
// func (s *LiveKitService) LeaveRoom(participantID, meetingID uuid.UUID) error {
// 	ctx := context.Background()

// 	// Find participant record
// 	var participant LiveKitParticipant
// 	if err := s.db.Where("meeting_id = ? AND participant_id = ? AND is_active = ?",
// 		meetingID, participantID, true).First(&participant).Error; err != nil {
// 		if err == gorm.ErrRecordNotFound {
// 			s.logger.WithFields(logrus.Fields{
// 				"participant_id": participantID,
// 				"meeting_id":     meetingID,
// 			}).Warn("Participant not found or already left room")
// 			return nil
// 		}
// 		return fmt.Errorf("failed to find participant: %w", err)
// 	}

// 	// Update participant record
// 	now := time.Now()
// 	if err := s.db.Model(&participant).Updates(map[string]interface{}{
// 		"is_active": false,
// 		"left_at":   &now,
// 	}).Error; err != nil {
// 		return fmt.Errorf("failed to update participant record: %w", err)
// 	}

// 	// Update participant count in Redis
// 	participantCountKey := fmt.Sprintf("livekit_participants:%s", meetingID.String())
// 	count, err := s.redis.Decr(ctx, participantCountKey).Result()
// 	if err != nil {
// 		s.logger.WithError(err).Warn("Failed to update participant count in Redis")
// 	} else {
// 		s.logger.WithFields(logrus.Fields{
// 			"meeting_id":        meetingID,
// 			"participant_count": count,
// 		}).Info("Participant left room")
// 	}

// 	// Clean up token from Redis
// 	tokenKey := fmt.Sprintf("livekit_token:%s:%s", meetingID.String(), participantID.String())
// 	if err := s.redis.Del(ctx, tokenKey).Err(); err != nil {
// 		s.logger.WithError(err).Warn("Failed to cleanup token from Redis")
// 	}

// 	return nil
// }

// // GetParticipants returns list of active participants in a room
// func (s *LiveKitService) GetParticipants(meetingID uuid.UUID) ([]LiveKitParticipant, error) {
// 	var participants []LiveKitParticipant
// 	if err := s.db.Where("meeting_id = ? AND is_active = ?", meetingID, true).Find(&participants).Error; err != nil {
// 		return nil, fmt.Errorf("failed to get participants: %w", err)
// 	}
// 	return participants, nil
// }

// // DeleteRoom deletes a LiveKit room
// func (s *LiveKitService) DeleteRoom(meetingID uuid.UUID) error {
// 	ctx := context.Background()

// 	// Get LiveKit room
// 	var liveKitRoom LiveKitRoom
// 	if err := s.db.Where("meeting_id = ?", meetingID).First(&liveKitRoom).Error; err != nil {
// 		if err == gorm.ErrRecordNotFound {
// 			s.logger.WithField("meeting_id", meetingID).Warn("LiveKit room not found for deletion")
// 			return nil
// 		}
// 		return fmt.Errorf("failed to get LiveKit room: %w", err)
// 	}

// 	// Mark all participants as inactive
// 	if err := s.db.Model(&LiveKitParticipant{}).Where("meeting_id = ?", meetingID).Updates(map[string]interface{}{
// 		"is_active": false,
// 		"left_at":   time.Now(),
// 	}).Error; err != nil {
// 		s.logger.WithError(err).WithField("meeting_id", meetingID).Warn("Failed to update participants on room deletion")
// 	}

// 	// Delete room from database
// 	if err := s.db.Delete(&liveKitRoom).Error; err != nil {
// 		return fmt.Errorf("failed to delete LiveKit room from database: %w", err)
// 	}

// 	// Clean up Redis
// 	participantCountKey := fmt.Sprintf("livekit_participants:%s", meetingID.String())
// 	s.redis.Del(ctx, participantCountKey)

// 	s.logger.WithField("meeting_id", meetingID).Info("LiveKit room deleted successfully")

// 	return nil
// }

// // IsRoomActive checks if a LiveKit room is active
// func (s *LiveKitService) IsRoomActive(meetingID uuid.UUID) (bool, error) {
// 	// Get LiveKit room
// 	var liveKitRoom LiveKitRoom
// 	if err := s.db.Where("meeting_id = ?", meetingID).First(&liveKitRoom).Error; err != nil {
// 		if err == gorm.ErrRecordNotFound {
// 			return false, nil
// 		}
// 		return false, fmt.Errorf("failed to get LiveKit room: %w", err)
// 	}

// 	// Check if room has active participants
// 	var count int64
// 	if err := s.db.Model(&LiveKitParticipant{}).Where("meeting_id = ? AND is_active = ?", meetingID, true).Count(&count).Error; err != nil {
// 		return false, fmt.Errorf("failed to count active participants: %w", err)
// 	}

// 	return count > 0, nil
// }

// // GetParticipantCount returns the number of active participants in a room
// func (s *LiveKitService) GetParticipantCount(meetingID uuid.UUID) (int64, error) {
// 	ctx := context.Background()

// 	// Try to get from Redis first
// 	participantCountKey := fmt.Sprintf("livekit_participants:%s", meetingID.String())
// 	count, err := s.redis.Get(ctx, participantCountKey).Int64()
// 	if err == nil {
// 		return count, nil
// 	}

// 	// Fallback to database
// 	var dbCount int64
// 	if err := s.db.Model(&LiveKitParticipant{}).Where("meeting_id = ? AND is_active = ?", meetingID, true).Count(&dbCount).Error; err != nil {
// 		return 0, fmt.Errorf("failed to count participants: %w", err)
// 	}

// 	// Cache in Redis
// 	s.redis.Set(ctx, participantCountKey, dbCount, 24*time.Hour)

// 	return dbCount, nil
// }

// // ValidateToken validates a LiveKit JWT token
// func (s *LiveKitService) ValidateToken(tokenString string) (*AccessTokenClaims, error) {
// 	token, err := jwt.ParseWithClaims(tokenString, &AccessTokenClaims{}, func(token *jwt.Token) (interface{}, error) {
// 		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
// 			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
// 		}
// 		return []byte(s.config.APISecret), nil
// 	})

// 	if err != nil {
// 		return nil, fmt.Errorf("failed to parse token: %w", err)
// 	}

// 	if claims, ok := token.Claims.(*AccessTokenClaims); ok && token.Valid {
// 		return claims, nil
// 	}

// 	return nil, fmt.Errorf("invalid token")
// }