package services

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

type TurnService struct {
	db         *gorm.DB
	redis      *redis.Client
	secretKey  string
	turnServer string
	logger     *logrus.Logger
}

type TurnCredentials struct {
	Username string   `json:"username"`
	Password string   `json:"password"`
	TTL      int      `json:"ttl"`
	URLs     []string `json:"urls"`
}

type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
	CredentialType string `json:"credentialType,omitempty"`
}

type TurnCredential struct {
	ID             uuid.UUID  `gorm:"primaryKey;type:uuid;default:gen_random_uuid()"`
	Username       string     `gorm:"size:255;not null;unique"`
	CredentialHash string     `gorm:"size:255;not null"`
	ExpiresAt      time.Time  `gorm:"not null"`
	CreatedAt      time.Time  `gorm:"autoCreateTime"`
	UserID         *uuid.UUID `gorm:"type:uuid;index"`
	MeetingID      *uuid.UUID `gorm:"type:uuid;index"`
}

type TurnUsageLog struct {
	ID               uuid.UUID `gorm:"primaryKey;type:uuid;default:gen_random_uuid()"`
	Username         string    `gorm:"size:255;not null"`
	Action           string    `gorm:"size:50;not null"` // 'allocate', 'refresh', 'deallocate'
	IPAddress        string    `gorm:"size:45"`          // IPv6 compatible
	UserAgent        string    `gorm:"type:text"`
	Timestamp        time.Time `gorm:"autoCreateTime"`
	BytesTransferred int64     `gorm:"default:0"`
}

func NewTurnService(db *gorm.DB, redis *redis.Client, secretKey, turnServer string) *TurnService {
	logger := logrus.New()
	logger.SetLevel(logrus.InfoLevel)

	service := &TurnService{
		db:         db,
		redis:      redis,
		secretKey:  secretKey,
		turnServer: turnServer,
		logger:     logger,
	}

	// Auto-migrate database tables
	if err := db.AutoMigrate(&TurnCredential{}, &TurnUsageLog{}); err != nil {
		logger.WithError(err).Error("Failed to migrate TURN tables")
	}

	return service
}

// GenerateCredentials generates TURN credentials for a user
func (s *TurnService) GenerateCredentials(ctx context.Context, userID, meetingID *uuid.UUID, ttl time.Duration) (*TurnCredentials, error) {
	// Generate username with timestamp
	expiry := time.Now().Add(ttl)
	username := fmt.Sprintf("%d:%s", expiry.Unix(), uuid.New().String())

	// Generate password using HMAC-SHA1
	password := s.generatePassword(username, s.secretKey)

	// Save credentials to database
	credential := &TurnCredential{
		Username:       username,
		CredentialHash: s.hashPassword(password),
		ExpiresAt:      expiry,
		UserID:         userID,
		MeetingID:      meetingID,
	}

	if err := s.db.Create(credential).Error; err != nil {
		s.logger.WithError(err).Error("Failed to save TURN credentials to database")
		return nil, fmt.Errorf("failed to save TURN credentials: %w", err)
	}

	// Cache credentials in Redis for quick validation
	key := fmt.Sprintf("turn:credentials:%s", username)
	credentialData := map[string]interface{}{
		"username": username,
		"password": password,
		"expires":  expiry.Unix(),
		"user_id":  userID,
		"meeting_id": meetingID,
	}

	if err := s.redis.HMSet(ctx, key, credentialData).Err(); err != nil {
		s.logger.WithError(err).Warn("Failed to cache TURN credentials in Redis")
	}

	// Set expiration in Redis
	if err := s.redis.Expire(ctx, key, ttl).Err(); err != nil {
		s.logger.WithError(err).Warn("Failed to set credential expiration in Redis")
	}

	// Get TURN server URLs
	turnURLs := s.getTurnServerURLs()

	s.logger.WithFields(logrus.Fields{
		"username":  username,
		"user_id":   userID,
		"meeting_id": meetingID,
		"expires":   expiry,
	}).Info("TURN credentials generated successfully")

	return &TurnCredentials{
		Username: username,
		Password: password,
		TTL:      int(ttl.Seconds()),
		URLs:     turnURLs,
	}, nil
}

// ValidateCredentials validates TURN credentials
func (s *TurnService) ValidateCredentials(ctx context.Context, username, password string) (bool, error) {
	// Check cache first
	key := fmt.Sprintf("turn:credentials:%s", username)
	cached, err := s.redis.HGetAll(ctx, key).Result()
	if err == nil && len(cached) > 0 {
		// Validate cached credentials
		if cached["password"] == password {
			// Check expiration
			expires, err := strconv.ParseInt(cached["expires"], 10, 64)
			if err == nil && time.Now().Unix() < expires {
				return true, nil
			}
		}
		// Remove invalid cached credentials
		s.redis.Del(ctx, key)
	}

	// Fallback to database validation
	var credential TurnCredential
	if err := s.db.Where("username = ? AND expires_at > ?", username, time.Now()).First(&credential).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return false, nil
		}
		return false, fmt.Errorf("failed to validate credentials: %w", err)
	}

	// Verify password hash
	if credential.CredentialHash != s.hashPassword(password) {
		return false, nil
	}

	// Re-cache valid credentials
	credentialData := map[string]interface{}{
		"username": credential.Username,
		"password": password,
		"expires":  credential.ExpiresAt.Unix(),
		"user_id":  credential.UserID,
		"meeting_id": credential.MeetingID,
	}
	s.redis.HMSet(ctx, key, credentialData)
	s.redis.Expire(ctx, key, time.Until(credential.ExpiresAt))

	return true, nil
}

// GetICEServers returns ICE server configuration
func (s *TurnService) GetICEServers(ctx context.Context, userID, meetingID *uuid.UUID) ([]ICEServer, error) {
	// Get TURN credentials
	credentials, err := s.GenerateCredentials(ctx, userID, meetingID, 24*time.Hour)
	if err != nil {
		s.logger.WithError(err).Error("Failed to generate TURN credentials for ICE servers")
		return nil, fmt.Errorf("failed to generate TURN credentials: %w", err)
	}

	// Build ICE servers list
	var iceServers []ICEServer

	// Add STUN servers
	stunServers := []string{
		"stun:stun.l.google.com:19302",
		"stun:stun1.l.google.com:19302",
		"stun:stun2.l.google.com:19302",
		"stun:stun.microsoft.com:3478",
	}

	for _, stunURL := range stunServers {
		iceServers = append(iceServers, ICEServer{
			URLs: []string{stunURL},
		})
	}

	// Add TURN servers with credentials
	for _, turnURL := range credentials.URLs {
		iceServers = append(iceServers, ICEServer{
			URLs:           []string{turnURL},
			Username:       credentials.Username,
			Credential:     credentials.Password,
			CredentialType: "password",
		})
	}

	return iceServers, nil
}

// RevokeCredentials revokes TURN credentials for a user
func (s *TurnService) RevokeCredentials(ctx context.Context, username string) error {
	// Remove from database
	if err := s.db.Where("username = ?", username).Delete(&TurnCredential{}).Error; err != nil {
		s.logger.WithError(err).WithField("username", username).Error("Failed to revoke TURN credentials from database")
		return fmt.Errorf("failed to revoke TURN credentials: %w", err)
	}

	// Remove from Redis cache
	key := fmt.Sprintf("turn:credentials:%s", username)
	if err := s.redis.Del(ctx, key).Err(); err != nil {
		s.logger.WithError(err).WithField("username", username).Warn("Failed to revoke TURN credentials from Redis")
	}

	s.logger.WithField("username", username).Info("TURN credentials revoked successfully")

	return nil
}

// LogUsage logs TURN server usage
func (s *TurnService) LogUsage(ctx context.Context, username, action, ipAddress, userAgent string, bytesTransferred int64) error {
	log := &TurnUsageLog{
		Username:         username,
		Action:           action,
		IPAddress:        ipAddress,
		UserAgent:        userAgent,
		BytesTransferred: bytesTransferred,
	}

	if err := s.db.Create(log).Error; err != nil {
		s.logger.WithError(err).Error("Failed to log TURN usage")
		return fmt.Errorf("failed to log TURN usage: %w", err)
	}

	// Update usage metrics in Redis
	metricsKey := fmt.Sprintf("turn:metrics:%s", username)
	pipe := s.redis.Pipeline()
	pipe.HIncrBy(ctx, metricsKey, "total_bytes", bytesTransferred)
	pipe.HIncrBy(ctx, metricsKey, "request_count", 1)
	pipe.HSet(ctx, metricsKey, "last_activity", time.Now().Unix())
	pipe.Expire(ctx, metricsKey, 24*time.Hour)

	if _, err := pipe.Exec(ctx); err != nil {
		s.logger.WithError(err).Warn("Failed to update TURN usage metrics in Redis")
	}

	return nil
}

// GetStats returns TURN server statistics
func (s *TurnService) GetStats(ctx context.Context) (map[string]interface{}, error) {
	stats := make(map[string]interface{})

	// Get active credentials count
	var activeCredentials int64
	if err := s.db.Model(&TurnCredential{}).Where("expires_at > ?", time.Now()).Count(&activeCredentials).Error; err != nil {
		return nil, fmt.Errorf("failed to count active credentials: %w", err)
	}
	stats["active_credentials"] = activeCredentials

	// Get total usage logs today
	var todayUsage int64
	today := time.Now().Truncate(24 * time.Hour)
	if err := s.db.Model(&TurnUsageLog{}).Where("timestamp >= ?", today).Count(&todayUsage).Error; err != nil {
		return nil, fmt.Errorf("failed to count today usage: %w", err)
	}
	stats["today_requests"] = todayUsage

	// Get total bytes transferred
	var totalBytes int64
	if err := s.db.Model(&TurnUsageLog{}).Select("COALESCE(SUM(bytes_transferred), 0)").Scan(&totalBytes).Error; err != nil {
		return nil, fmt.Errorf("failed to get total bytes transferred: %w", err)
	}
	stats["total_bytes_transferred"] = totalBytes

	// Get Redis info
	info, err := s.redis.Info(ctx).Result()
	if err != nil {
		s.logger.WithError(err).Warn("Failed to get Redis info")
	} else {
		stats["redis_info"] = info
	}

	return stats, nil
}

// CleanupExpiredCredentials removes expired credentials
func (s *TurnService) CleanupExpiredCredentials(ctx context.Context) error {
	// Clean up database
	result := s.db.Where("expires_at <= ?", time.Now()).Delete(&TurnCredential{})
	if result.Error != nil {
		return fmt.Errorf("failed to cleanup expired credentials: %w", result.Error)
	}

	s.logger.WithField("deleted_count", result.RowsAffected).Info("Cleaned up expired TURN credentials")

	// Clean up Redis cache
	pattern := "turn:credentials:*"
	keys, err := s.redis.Keys(ctx, pattern).Result()
	if err != nil {
		s.logger.WithError(err).Warn("Failed to get credential keys from Redis")
		return nil
	}

	var deletedKeys []string
	now := time.Now().Unix()

	for _, key := range keys {
		expires, err := s.redis.HGet(ctx, key, "expires").Int64()
		if err != nil {
			continue
		}

		if now > expires {
			deletedKeys = append(deletedKeys, key)
		}
	}

	if len(deletedKeys) > 0 {
		if err := s.redis.Del(ctx, deletedKeys...).Err(); err != nil {
			s.logger.WithError(err).Warn("Failed to delete expired credentials from Redis")
		} else {
			s.logger.WithField("deleted_count", len(deletedKeys)).Info("Cleaned up expired TURN credentials from Redis")
		}
	}

	return nil
}

// Helper methods

func (s *TurnService) generatePassword(username, secret string) string {
	h := hmac.New(sha1.New, []byte(secret))
	h.Write([]byte(username))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

func (s *TurnService) hashPassword(password string) string {
	h := sha1.New()
	h.Write([]byte(password))
	return fmt.Sprintf("%x", h.Sum(nil))
}

func (s *TurnService) getTurnServerURLs() []string {
	if s.turnServer != "" {
		return []string{
			fmt.Sprintf("turn:%s:3478", s.turnServer),
			fmt.Sprintf("turns:%s:5349", s.turnServer),
		}
	}

	// Default TURN servers for development
	return []string{
		"turn:127.0.0.1:3478",
		"turns:127.0.0.1:5349",
	}
}

func splitUsername(username string) []string {
	return strings.Split(username, ":")
}