package cache

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/filosofine/gomeet-backend/internal/models"
	"github.com/filosofine/gomeet-backend/internal/redis"
	"github.com/sirupsen/logrus"
)

type CacheRepository struct {
	redisClient *redis.RedisClient
	logger      *logrus.Logger
}

type CacheEntry struct {
	Data      interface{} `json:"data"`
	Timestamp time.Time   `json:"timestamp"`
	TTL       time.Duration `json:"ttl"`
}

type CacheStats struct {
	Hits        int64     `json:"hits"`
	Misses      int64     `json:"misses"`
	Sets        int64     `json:"sets"`
	Deletes     int64     `json:"deletes"`
	Errors      int64     `json:"errors"`
	LastUpdated time.Time `json:"last_updated"`
}

// Cache key patterns
const (
	UserProfileKeyPattern    = "user:profile:%s"
	MeetingDetailsKeyPattern = "meeting:details:%s"
	ParticipantListKeyPattern = "meeting:participants:%s"
	FeatureFlagKeyPattern    = "feature_flag:%s"
	PublicUserKeyPattern     = "public_user:%s"
	CacheStatsKey           = "cache:stats"
)

// TTL values
const (
	UserProfileTTL    = 30 * time.Minute
	MeetingDetailsTTL = 15 * time.Minute
	ParticipantListTTL = 10 * time.Minute
	FeatureFlagTTL    = 5 * time.Minute
	PublicUserTTL     = 30 * time.Minute
)

func NewCacheRepository(redisClient *redis.RedisClient) *CacheRepository {
	logger := logrus.New()
	logger.SetLevel(logrus.InfoLevel)

	repo := &CacheRepository{
		redisClient: redisClient,
		logger:      logger,
	}

	// Initialize cache stats
	repo.initializeStats()

	return repo
}

// initializeStats sets up initial cache statistics
func (r *CacheRepository) initializeStats() {
	stats := &CacheStats{
		Hits:        0,
		Misses:      0,
		Sets:        0,
		Deletes:     0,
		Errors:      0,
		LastUpdated: time.Now(),
	}

	if err := r.redisClient.Set(CacheStatsKey, stats, 24*time.Hour); err != nil {
		r.logger.WithError(err).Error("Failed to initialize cache stats")
	}
}

// getStats retrieves current cache statistics
func (r *CacheRepository) getStats() (*CacheStats, error) {
	var stats CacheStats
	if err := r.redisClient.Get(CacheStatsKey, &stats); err != nil {
		return nil, err
	}
	return &stats, nil
}

// updateStats updates cache statistics
func (r *CacheRepository) updateStats(updateFunc func(*CacheStats)) error {
	stats, err := r.getStats()
	if err != nil {
		return err
	}

	updateFunc(stats)
	stats.LastUpdated = time.Now()

	return r.redisClient.Set(CacheStatsKey, stats, 24*time.Hour)
}

// logCacheEvent logs cache events with structured logging
func (r *CacheRepository) logCacheEvent(event, key string, hit bool, err error, duration time.Duration) {
	fields := logrus.Fields{
		"event":    event,
		"key":      key,
		"hit":      hit,
		"duration": duration.Milliseconds(),
	}

	if err != nil {
		fields["error"] = err.Error()
		r.logger.WithFields(fields).Error("Cache operation failed")
	} else {
		r.logger.WithFields(fields).Info("Cache operation completed")
	}
}

// Get retrieves data from cache using cache-aside pattern
func (r *CacheRepository) Get(key string, dest interface{}) (bool, error) {
	start := time.Now()
	defer func() {
		duration := time.Since(start)
		r.logCacheEvent("get", key, true, nil, duration)
	}()

	if !r.redisClient.IsConnected() {
		r.logger.Warn("Redis not connected, skipping cache get")
		return false, fmt.Errorf("redis not connected")
	}

	var entry CacheEntry
	if err := r.redisClient.Get(key, &entry); err != nil {
		// Update miss count
		if updateErr := r.updateStats(func(stats *CacheStats) { stats.Misses++ }); updateErr != nil {
			r.logger.WithError(updateErr).Error("Failed to update cache miss stats")
		}

		duration := time.Since(start)
		r.logCacheEvent("get", key, false, err, duration)
		return false, err
	}

	// Check if cache entry is expired
	if time.Since(entry.Timestamp) > entry.TTL {
		// Cache expired, delete it
		if err := r.Delete(key); err != nil {
			r.logger.WithError(err).Error("Failed to delete expired cache entry")
		}
		
		duration := time.Since(start)
		r.logCacheEvent("get", key, false, fmt.Errorf("cache expired"), duration)
		return false, fmt.Errorf("cache expired")
	}

	// Update hit count
	if err := r.updateStats(func(stats *CacheStats) { stats.Hits++ }); err != nil {
		r.logger.WithError(err).Error("Failed to update cache hit stats")
	}

	// Unmarshal data
	dataBytes, err := json.Marshal(entry.Data)
	if err != nil {
		duration := time.Since(start)
		r.logCacheEvent("get", key, false, err, duration)
		return false, fmt.Errorf("failed to marshal cached data: %w", err)
	}

	if err := json.Unmarshal(dataBytes, dest); err != nil {
		duration := time.Since(start)
		r.logCacheEvent("get", key, false, err, duration)
		return false, fmt.Errorf("failed to unmarshal cached data: %w", err)
	}

	return true, nil
}

// Set stores data in cache with TTL
func (r *CacheRepository) Set(key string, data interface{}, ttl time.Duration) error {
	start := time.Now()
	defer func() {
		duration := time.Since(start)
		r.logCacheEvent("set", key, true, nil, duration)
	}()

	if !r.redisClient.IsConnected() {
		r.logger.Warn("Redis not connected, skipping cache set")
		return fmt.Errorf("redis not connected")
	}

	entry := CacheEntry{
		Data:      data,
		Timestamp: time.Now(),
		TTL:       ttl,
	}

	if err := r.redisClient.Set(key, entry, ttl); err != nil {
		// Update error count
		if updateErr := r.updateStats(func(stats *CacheStats) { stats.Errors++ }); updateErr != nil {
			r.logger.WithError(updateErr).Error("Failed to update cache error stats")
		}

		duration := time.Since(start)
		r.logCacheEvent("set", key, false, err, duration)
		return fmt.Errorf("failed to set cache: %w", err)
	}

	// Update set count
	if err := r.updateStats(func(stats *CacheStats) { stats.Sets++ }); err != nil {
		r.logger.WithError(err).Error("Failed to update cache set stats")
	}

	return nil
}

// Delete removes data from cache
func (r *CacheRepository) Delete(key string) error {
	start := time.Now()
	defer func() {
		duration := time.Since(start)
		r.logCacheEvent("delete", key, true, nil, duration)
	}()

	if !r.redisClient.IsConnected() {
		r.logger.Warn("Redis not connected, skipping cache delete")
		return fmt.Errorf("redis not connected")
	}

	if err := r.redisClient.Delete(key); err != nil {
		// Update error count
		if updateErr := r.updateStats(func(stats *CacheStats) { stats.Errors++ }); updateErr != nil {
			r.logger.WithError(updateErr).Error("Failed to update cache error stats")
		}

		duration := time.Since(start)
		r.logCacheEvent("delete", key, false, err, duration)
		return fmt.Errorf("failed to delete cache: %w", err)
	}

	// Update delete count
	if err := r.updateStats(func(stats *CacheStats) { stats.Deletes++ }); err != nil {
		r.logger.WithError(err).Error("Failed to update cache delete stats")
	}

	return nil
}

// DeleteByPattern removes cache entries matching a pattern
func (r *CacheRepository) DeleteByPattern(pattern string) error {
	if !r.redisClient.IsConnected() {
		r.logger.Warn("Redis not connected, skipping cache delete by pattern")
		return fmt.Errorf("redis not connected")
	}

	keys, err := r.redisClient.Keys(pattern)
	if err != nil {
		return fmt.Errorf("failed to get keys for pattern %s: %w", pattern, err)
	}

	for _, key := range keys {
		if err := r.Delete(key); err != nil {
			r.logger.WithError(err).WithField("key", key).Error("Failed to delete cache key")
		}
	}

	return nil
}

// GetUserProfileKey generates cache key for user profile
func (r *CacheRepository) GetUserProfileKey(userID string) string {
	return fmt.Sprintf(UserProfileKeyPattern, userID)
}

// GetMeetingDetailsKey generates cache key for meeting details
func (r *CacheRepository) GetMeetingDetailsKey(meetingID string) string {
	return fmt.Sprintf(MeetingDetailsKeyPattern, meetingID)
}

// GetParticipantListKey generates cache key for participant list
func (r *CacheRepository) GetParticipantListKey(meetingID string) string {
	return fmt.Sprintf(ParticipantListKeyPattern, meetingID)
}

// GetFeatureFlagKey generates cache key for feature flag
func (r *CacheRepository) GetFeatureFlagKey(flagName string) string {
	return fmt.Sprintf(FeatureFlagKeyPattern, flagName)
}

// GetPublicUserKey generates cache key for public user
func (r *CacheRepository) GetPublicUserKey(sessionID string) string {
	return fmt.Sprintf(PublicUserKeyPattern, sessionID)
}

// UserProfile caching operations
func (r *CacheRepository) GetUserProfile(userID string) (*models.UserResponse, bool, error) {
	var userResponse models.UserResponse
	
	found, err := r.Get(r.GetUserProfileKey(userID), &userResponse)
	if err != nil {
		r.logger.WithError(err).WithField("user_id", userID).Error("Failed to get user profile from cache")
		return nil, false, err
	}

	if found {
		r.logger.WithField("user_id", userID).Info("User profile cache hit")
		return &userResponse, true, nil
	}

	r.logger.WithField("user_id", userID).Info("User profile cache miss")
	return nil, false, nil
}

func (r *CacheRepository) SetUserProfile(userID string, userResponse *models.UserResponse) error {
	err := r.Set(r.GetUserProfileKey(userID), userResponse, UserProfileTTL)
	if err != nil {
		r.logger.WithError(err).WithField("user_id", userID).Error("Failed to set user profile in cache")
		return err
	}

	r.logger.WithField("user_id", userID).Info("User profile cached successfully")
	return nil
}

func (r *CacheRepository) InvalidateUserProfile(userID string) error {
	err := r.Delete(r.GetUserProfileKey(userID))
	if err != nil {
		r.logger.WithError(err).WithField("user_id", userID).Error("Failed to invalidate user profile cache")
		return err
	}

	r.logger.WithField("user_id", userID).Info("User profile cache invalidated")
	return nil
}

// MeetingDetails caching operations
func (r *CacheRepository) GetMeetingDetails(meetingID string) (*models.MeetingResponse, bool, error) {
	var meetingResponse models.MeetingResponse
	
	found, err := r.Get(r.GetMeetingDetailsKey(meetingID), &meetingResponse)
	if err != nil {
		r.logger.WithError(err).WithField("meeting_id", meetingID).Error("Failed to get meeting details from cache")
		return nil, false, err
	}

	if found {
		r.logger.WithField("meeting_id", meetingID).Info("Meeting details cache hit")
		return &meetingResponse, true, nil
	}

	r.logger.WithField("meeting_id", meetingID).Info("Meeting details cache miss")
	return nil, false, nil
}

func (r *CacheRepository) SetMeetingDetails(meetingID string, meetingResponse *models.MeetingResponse) error {
	err := r.Set(r.GetMeetingDetailsKey(meetingID), meetingResponse, MeetingDetailsTTL)
	if err != nil {
		r.logger.WithError(err).WithField("meeting_id", meetingID).Error("Failed to set meeting details in cache")
		return err
	}

	r.logger.WithField("meeting_id", meetingID).Info("Meeting details cached successfully")
	return nil
}

func (r *CacheRepository) InvalidateMeetingDetails(meetingID string) error {
	err := r.Delete(r.GetMeetingDetailsKey(meetingID))
	if err != nil {
		r.logger.WithError(err).WithField("meeting_id", meetingID).Error("Failed to invalidate meeting details cache")
		return err
	}

	r.logger.WithField("meeting_id", meetingID).Info("Meeting details cache invalidated")
	return nil
}

// ParticipantList caching operations
func (r *CacheRepository) GetParticipantList(meetingID string) ([]models.ParticipantResponse, bool, error) {
	var participants []models.ParticipantResponse
	
	found, err := r.Get(r.GetParticipantListKey(meetingID), &participants)
	if err != nil {
		r.logger.WithError(err).WithField("meeting_id", meetingID).Error("Failed to get participant list from cache")
		return nil, false, err
	}

	if found {
		r.logger.WithField("meeting_id", meetingID).Info("Participant list cache hit")
		return participants, true, nil
	}

	r.logger.WithField("meeting_id", meetingID).Info("Participant list cache miss")
	return nil, false, nil
}

func (r *CacheRepository) SetParticipantList(meetingID string, participants []models.ParticipantResponse) error {
	err := r.Set(r.GetParticipantListKey(meetingID), participants, ParticipantListTTL)
	if err != nil {
		r.logger.WithError(err).WithField("meeting_id", meetingID).Error("Failed to set participant list in cache")
		return err
	}

	r.logger.WithField("meeting_id", meetingID).WithField("participant_count", len(participants)).Info("Participant list cached successfully")
	return nil
}

func (r *CacheRepository) InvalidateParticipantList(meetingID string) error {
	err := r.Delete(r.GetParticipantListKey(meetingID))
	if err != nil {
		r.logger.WithError(err).WithField("meeting_id", meetingID).Error("Failed to invalidate participant list cache")
		return err
	}

	r.logger.WithField("meeting_id", meetingID).Info("Participant list cache invalidated")
	return nil
}

// FeatureFlag caching operations
func (r *CacheRepository) GetFeatureFlag(flagName string) (bool, bool, error) {
	var enabled bool
	
	found, err := r.Get(r.GetFeatureFlagKey(flagName), &enabled)
	if err != nil {
		r.logger.WithError(err).WithField("flag_name", flagName).Error("Failed to get feature flag from cache")
		return false, false, err
	}

	if found {
		r.logger.WithField("flag_name", flagName).Info("Feature flag cache hit")
		return enabled, true, nil
	}

	r.logger.WithField("flag_name", flagName).Info("Feature flag cache miss")
	return false, false, nil
}

func (r *CacheRepository) SetFeatureFlag(flagName string, enabled bool) error {
	err := r.Set(r.GetFeatureFlagKey(flagName), enabled, FeatureFlagTTL)
	if err != nil {
		r.logger.WithError(err).WithField("flag_name", flagName).Error("Failed to set feature flag in cache")
		return err
	}

	r.logger.WithField("flag_name", flagName).Info("Feature flag cached successfully")
	return nil
}

func (r *CacheRepository) InvalidateFeatureFlag(flagName string) error {
	err := r.Delete(r.GetFeatureFlagKey(flagName))
	if err != nil {
		r.logger.WithError(err).WithField("flag_name", flagName).Error("Failed to invalidate feature flag cache")
		return err
	}

	r.logger.WithField("flag_name", flagName).Info("Feature flag cache invalidated")
	return nil
}

// PublicUser caching operations
func (r *CacheRepository) GetPublicUser(sessionID string) (*models.PublicUserResponse, bool, error) {
	var publicUserResponse models.PublicUserResponse
	
	found, err := r.Get(r.GetPublicUserKey(sessionID), &publicUserResponse)
	if err != nil {
		r.logger.WithError(err).WithField("session_id", sessionID).Error("Failed to get public user from cache")
		return nil, false, err
	}

	if found {
		r.logger.WithField("session_id", sessionID).Info("Public user cache hit")
		return &publicUserResponse, true, nil
	}

	r.logger.WithField("session_id", sessionID).Info("Public user cache miss")
	return nil, false, nil
}

func (r *CacheRepository) SetPublicUser(sessionID string, publicUserResponse *models.PublicUserResponse) error {
	err := r.Set(r.GetPublicUserKey(sessionID), publicUserResponse, PublicUserTTL)
	if err != nil {
		r.logger.WithError(err).WithField("session_id", sessionID).Error("Failed to set public user in cache")
		return err
	}

	r.logger.WithField("session_id", sessionID).Info("Public user cached successfully")
	return nil
}

func (r *CacheRepository) InvalidatePublicUser(sessionID string) error {
	err := r.Delete(r.GetPublicUserKey(sessionID))
	if err != nil {
		r.logger.WithError(err).WithField("session_id", sessionID).Error("Failed to invalidate public user cache")
		return err
	}

	r.logger.WithField("session_id", sessionID).Info("Public user cache invalidated")
	return nil
}

// MeetingList caching operations (for pagination results)
func (r *CacheRepository) GetMeetingList(cacheKey string) (*models.MeetingListResponse, bool, error) {
	var meetingListResponse models.MeetingListResponse
	
	found, err := r.Get(cacheKey, &meetingListResponse)
	if err != nil {
		r.logger.WithError(err).WithField("cache_key", cacheKey).Error("Failed to get meeting list from cache")
		return nil, false, err
	}

	if found {
		r.logger.WithField("cache_key", cacheKey).Info("Meeting list cache hit")
		return &meetingListResponse, true, nil
	}

	r.logger.WithField("cache_key", cacheKey).Info("Meeting list cache miss")
	return nil, false, nil
}

func (r *CacheRepository) SetMeetingList(cacheKey string, meetingListResponse *models.MeetingListResponse) error {
	// Use shorter TTL for list data (5 minutes)
	err := r.Set(cacheKey, meetingListResponse, 5*time.Minute)
	if err != nil {
		r.logger.WithError(err).WithField("cache_key", cacheKey).Error("Failed to set meeting list in cache")
		return err
	}

	r.logger.WithField("cache_key", cacheKey).Info("Meeting list cached successfully")
	return nil
}

// Bulk invalidation operations
func (r *CacheRepository) InvalidateMeetingRelated(meetingID string) error {
	patterns := []string{
		r.GetMeetingDetailsKey(meetingID),
		r.GetParticipantListKey(meetingID),
	}

	for _, pattern := range patterns {
		if err := r.Delete(pattern); err != nil {
			r.logger.WithError(err).WithField("key", pattern).Error("Failed to invalidate meeting-related cache")
		}
	}

	return nil
}

func (r *CacheRepository) InvalidateUserRelated(userID string) error {
	patterns := []string{
		r.GetUserProfileKey(userID),
	}

	// Also invalidate meetings where user is host or participant
	meetingPattern := fmt.Sprintf("meeting:*:%s", userID)
	if err := r.DeleteByPattern(meetingPattern); err != nil {
		r.logger.WithError(err).WithField("pattern", meetingPattern).Error("Failed to invalidate user meeting cache")
	}

	for _, pattern := range patterns {
		if err := r.Delete(pattern); err != nil {
			r.logger.WithError(err).WithField("key", pattern).Error("Failed to invalidate user-related cache")
		}
	}

	return nil
}

// Generate cache key for meeting lists
func (r *CacheRepository) GenerateMeetingListKey(hostID string, page, limit int, search string) string {
	if search != "" {
		return fmt.Sprintf("meeting:list:%s:page:%d:limit:%d:search:%s", hostID, page, limit, search)
	}
	return fmt.Sprintf("meeting:list:%s:page:%d:limit:%d", hostID, page, limit)
}

// Generate cache key for joined meetings
func (r *CacheRepository) GenerateJoinedMeetingsKey(userID string, page, limit int) string {
	return fmt.Sprintf("meeting:joined:%s:page:%d:limit:%d", userID, page, limit)
}

// Generate cache key for upcoming meetings
func (r *CacheRepository) GenerateUpcomingMeetingsKey(hostID string, limit int) string {
	return fmt.Sprintf("meeting:upcoming:%s:limit:%d", hostID, limit)
}

// Generate cache key for past meetings
func (r *CacheRepository) GeneratePastMeetingsKey(hostID string, page, limit int) string {
	return fmt.Sprintf("meeting:past:%s:page:%d:limit:%d", hostID, page, limit)
}

// Get cache statistics
func (r *CacheRepository) GetCacheStats() (*CacheStats, error) {
	return r.getStats()
}

// Health check for cache repository
func (r *CacheRepository) HealthCheck() error {
	if !r.redisClient.IsConnected() {
		return fmt.Errorf("redis not connected")
	}

	// Test set/get operation
	testKey := "health_check_test"
	testValue := "test_value"
	
	if err := r.redisClient.Set(testKey, testValue, time.Minute); err != nil {
		return fmt.Errorf("cache health check failed: %w", err)
	}

	var result string
	if err := r.redisClient.Get(testKey, &result); err != nil {
		return fmt.Errorf("cache health check failed: %w", err)
	}

	if result != testValue {
		return fmt.Errorf("cache health check failed: value mismatch")
	}

	// Clean up test key
	if err := r.redisClient.Delete(testKey); err != nil {
		r.logger.WithError(err).Error("Failed to clean up health check test key")
	}

	return nil
}