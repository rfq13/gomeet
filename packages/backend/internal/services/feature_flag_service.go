package services

import (
	"context"
	"fmt"
	"time"

	"github.com/filosofine/gomeet-backend/internal/cache"
	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

type FeatureFlagService struct {
	redis     *redis.Client
	db        *gorm.DB
	logger    *logrus.Logger
	cacheRepo *cache.CacheRepository
}

type FeatureFlag struct {
	Name        string    `json:"name"`
	Enabled     bool      `json:"enabled"`
	Description string    `json:"description"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type FeatureFlagConfig struct {
	UseLiveKitSFU bool `json:"use_livekit_sfu"`
	UseWebRTCMesh bool `json:"use_webrtc_mesh"`
	EnableSFULogs bool `json:"enable_sfu_logs"`
}

const (
	// Feature flags
	FeatureUseLiveKitSFU = "use_livekit_sfu"
	FeatureUseWebRTCMesh = "use_webrtc_mesh"
	FeatureEnableSFULogs = "enable_sfu_logs"
	
	// Default values
	DefaultUseLiveKitSFU = false // Start with mesh, gradually enable SFU
	DefaultUseWebRTCMesh = true
	DefaultEnableSFULogs = true
)

func NewFeatureFlagService(redisClient *redis.Client, db *gorm.DB, cacheRepo *cache.CacheRepository) *FeatureFlagService {
	logger := logrus.New()
	logger.SetLevel(logrus.InfoLevel)

	service := &FeatureFlagService{
		redis:     redisClient,
		db:        db,
		logger:    logger,
		cacheRepo: cacheRepo,
	}

	// Initialize default feature flags
	service.initializeDefaultFlags()

	return service
}

// initializeDefaultFlags sets up default feature flags
func (s *FeatureFlagService) initializeDefaultFlags() {
	ctx := context.Background()
	
	defaultFlags := map[string]bool{
		FeatureUseLiveKitSFU: DefaultUseLiveKitSFU,
		FeatureUseWebRTCMesh: DefaultUseWebRTCMesh,
		FeatureEnableSFULogs: DefaultEnableSFULogs,
	}

	for flagName, enabled := range defaultFlags {
		// Only set if not already exists
		exists, err := s.redis.Exists(ctx, s.getFlagKey(flagName)).Result()
		if err != nil {
			s.logger.WithError(err).Error("Failed to check feature flag existence")
			continue
		}

		if exists == 0 {
			if err := s.setFlag(ctx, flagName, enabled); err != nil {
				s.logger.WithError(err).WithField("flag", flagName).Error("Failed to set default feature flag")
			} else {
				s.logger.WithFields(logrus.Fields{
					"flag":    flagName,
					"enabled": enabled,
				}).Info("Set default feature flag")
			}
		}
	}
}

// getFlagKey returns the Redis key for a feature flag
func (s *FeatureFlagService) getFlagKey(flagName string) string {
	return fmt.Sprintf("feature_flag:%s", flagName)
}

// setFlag sets a feature flag value
func (s *FeatureFlagService) setFlag(ctx context.Context, flagName string, enabled bool) error {
	// Store in Redis with 24 hour expiry
	key := s.getFlagKey(flagName)
	if err := s.redis.Set(ctx, key, enabled, 24*time.Hour).Err(); err != nil {
		return fmt.Errorf("failed to set feature flag in Redis: %w", err)
	}

	// Log the change
	s.logger.WithFields(logrus.Fields{
		"flag":    flagName,
		"enabled": enabled,
	}).Info("Feature flag updated")

	return nil
}

// getFlagDescription returns a description for a feature flag
func (s *FeatureFlagService) getFlagDescription(flagName string) string {
	descriptions := map[string]string{
		FeatureUseLiveKitSFU: "Use LiveKit SFU for video conferencing instead of mesh WebRTC",
		FeatureUseWebRTCMesh: "Use traditional mesh WebRTC for video conferencing",
		FeatureEnableSFULogs: "Enable detailed logging for SFU operations",
	}

	if desc, exists := descriptions[flagName]; exists {
		return desc
	}
	return "Feature flag"
}

// IsFlagEnabled checks if a feature flag is enabled
func (s *FeatureFlagService) IsFlagEnabled(flagName string) (bool, error) {
	// Try to get from cache first
	enabled, found, err := s.cacheRepo.GetFeatureFlag(flagName)
	if err != nil {
		s.logger.WithError(err).WithField("flag", flagName).Error("Failed to get feature flag from cache")
	}
	
	if found {
		return enabled, nil
	}

	// Cache miss, get from Redis
	ctx := context.Background()
	key := s.getFlagKey(flagName)

	redisEnabled, err := s.redis.Get(ctx, key).Bool()
	if err == nil {
		// Cache the result
		if cacheErr := s.cacheRepo.SetFeatureFlag(flagName, redisEnabled); cacheErr != nil {
			s.logger.WithError(cacheErr).WithField("flag", flagName).Error("Failed to cache feature flag")
		}
		return redisEnabled, nil
	}

	if err != redis.Nil {
		s.logger.WithError(err).WithField("flag", flagName).Error("Failed to get feature flag from Redis")
	}

	// Fallback to default values
	var defaultValue bool
	switch flagName {
	case FeatureUseLiveKitSFU:
		defaultValue = DefaultUseLiveKitSFU
	case FeatureUseWebRTCMesh:
		defaultValue = DefaultUseWebRTCMesh
	case FeatureEnableSFULogs:
		defaultValue = DefaultEnableSFULogs
	default:
		return false, fmt.Errorf("unknown feature flag: %s", flagName)
	}

	// Cache the default value
	if cacheErr := s.cacheRepo.SetFeatureFlag(flagName, defaultValue); cacheErr != nil {
		s.logger.WithError(cacheErr).WithField("flag", flagName).Error("Failed to cache feature flag default value")
	}

	return defaultValue, nil
}

// SetFlag enables or disables a feature flag
func (s *FeatureFlagService) SetFlag(flagName string, enabled bool) error {
	ctx := context.Background()
	
	// Set in Redis
	if err := s.setFlag(ctx, flagName, enabled); err != nil {
		return err
	}
	
	// Update cache
	if err := s.cacheRepo.SetFeatureFlag(flagName, enabled); err != nil {
		s.logger.WithError(err).WithField("flag", flagName).Error("Failed to update feature flag cache")
	}
	
	return nil
}

// GetFeatureConfig returns the current feature configuration
func (s *FeatureFlagService) GetFeatureConfig() (*FeatureFlagConfig, error) {
	config := &FeatureFlagConfig{}

	// Get each feature flag
	useSFU, err := s.IsFlagEnabled(FeatureUseLiveKitSFU)
	if err != nil {
		return nil, fmt.Errorf("failed to get %s flag: %w", FeatureUseLiveKitSFU, err)
	}
	config.UseLiveKitSFU = useSFU

	useMesh, err := s.IsFlagEnabled(FeatureUseWebRTCMesh)
	if err != nil {
		return nil, fmt.Errorf("failed to get %s flag: %w", FeatureUseWebRTCMesh, err)
	}
	config.UseWebRTCMesh = useMesh

	enableLogs, err := s.IsFlagEnabled(FeatureEnableSFULogs)
	if err != nil {
		return nil, fmt.Errorf("failed to get %s flag: %w", FeatureEnableSFULogs, err)
	}
	config.EnableSFULogs = enableLogs

	return config, nil
}

// GetAllFlags returns all feature flags with their current status
func (s *FeatureFlagService) GetAllFlags() (map[string]*FeatureFlag, error) {
	flags := make(map[string]*FeatureFlag)

	flagNames := []string{
		FeatureUseLiveKitSFU,
		FeatureUseWebRTCMesh,
		FeatureEnableSFULogs,
	}

	for _, flagName := range flagNames {
		enabled, err := s.IsFlagEnabled(flagName)
		if err != nil {
			s.logger.WithError(err).WithField("flag", flagName).Error("Failed to get feature flag")
			continue
		}

		flags[flagName] = &FeatureFlag{
			Name:        flagName,
			Enabled:     enabled,
			Description: s.getFlagDescription(flagName),
			UpdatedAt:   time.Now(), // We could store this in Redis for more accuracy
		}
	}

	return flags, nil
}

// EnableLiveKitForMeeting enables LiveKit SFU for a specific meeting
func (s *FeatureFlagService) EnableLiveKitForMeeting(meetingID string) error {
	ctx := context.Background()
	key := fmt.Sprintf("meeting_livekit:%s", meetingID)
	
	if err := s.redis.Set(ctx, key, true, 24*time.Hour).Err(); err != nil {
		return fmt.Errorf("failed to enable LiveKit for meeting: %w", err)
	}

	s.logger.WithField("meeting_id", meetingID).Info("LiveKit enabled for specific meeting")
	return nil
}

// DisableLiveKitForMeeting disables LiveKit SFU for a specific meeting
func (s *FeatureFlagService) DisableLiveKitForMeeting(meetingID string) error {
	ctx := context.Background()
	key := fmt.Sprintf("meeting_livekit:%s", meetingID)
	
	if err := s.redis.Del(ctx, key).Err(); err != nil {
		return fmt.Errorf("failed to disable LiveKit for meeting: %w", err)
	}

	s.logger.WithField("meeting_id", meetingID).Info("LiveKit disabled for specific meeting")
	return nil
}

// ShouldUseLiveKitForMeeting checks if LiveKit should be used for a specific meeting
func (s *FeatureFlagService) ShouldUseLiveKitForMeeting(meetingID string) (bool, error) {
	ctx := context.Background()
	key := fmt.Sprintf("meeting_livekit:%s", meetingID)

	// Check if meeting has specific LiveKit setting
	enabled, err := s.redis.Get(ctx, key).Bool()
	if err == nil {
		return enabled, nil
	}

	if err != redis.Nil {
		s.logger.WithError(err).WithField("meeting_id", meetingID).Error("Failed to check LiveKit setting for meeting")
	}

	// Fallback to global feature flag
	return s.IsFlagEnabled(FeatureUseLiveKitSFU)
}

// GetMigrationStats returns statistics about the migration progress
func (s *FeatureFlagService) GetMigrationStats() (map[string]interface{}, error) {
	ctx := context.Background()
	
	// Count meetings with LiveKit enabled
	pattern := "meeting_livekit:*"
	keys, err := s.redis.Keys(ctx, pattern).Result()
	if err != nil {
		s.logger.WithError(err).Error("Failed to get LiveKit meeting keys")
	}

	liveKitMeetingCount := len(keys)

	// Get global flags
	config, err := s.GetFeatureConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to get feature config: %w", err)
	}

	stats := map[string]interface{}{
		"livekit_meeting_count": liveKitMeetingCount,
		"global_livekit_enabled": config.UseLiveKitSFU,
		"global_mesh_enabled":    config.UseWebRTCMesh,
		"sfu_logs_enabled":       config.EnableSFULogs,
		"migration_phase":       s.getMigrationPhase(config),
		"updated_at":            time.Now(),
	}

	return stats, nil
}

// getMigrationPhase determines the current migration phase based on feature flags
func (s *FeatureFlagService) getMigrationPhase(config *FeatureFlagConfig) string {
	if !config.UseLiveKitSFU && config.UseWebRTCMesh {
		return "mesh_only"
	}
	if config.UseLiveKitSFU && config.UseWebRTCMesh {
		return "parallel_testing"
	}
	if config.UseLiveKitSFU && !config.UseWebRTCMesh {
		return "sfu_only"
	}
	return "unknown"
}

// CleanupExpiredFlags cleans up expired feature flags and meeting-specific settings
func (s *FeatureFlagService) CleanupExpiredFlags() error {
	ctx := context.Background()
	
	// Clean up expired meeting-specific LiveKit settings
	pattern := "meeting_livekit:*"
	keys, err := s.redis.Keys(ctx, pattern).Result()
	if err != nil {
		return fmt.Errorf("failed to get meeting keys for cleanup: %w", err)
	}

	deletedCount := 0
	for _, key := range keys {
		ttl, err := s.redis.TTL(ctx, key).Result()
		if err != nil {
			s.logger.WithError(err).WithField("key", key).Error("Failed to get TTL for key")
			continue
		}

		if ttl == -1 { // No expiry set, clean it up
			if err := s.redis.Del(ctx, key).Err(); err != nil {
				s.logger.WithError(err).WithField("key", key).Error("Failed to delete expired key")
			} else {
				deletedCount++
			}
		}
	}

	s.logger.WithField("deleted_count", deletedCount).Info("Cleaned up expired feature flags")
	return nil
}