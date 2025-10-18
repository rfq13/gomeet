package services

import (
	"context"
	"testing"

	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupTestFeatureFlagService(t *testing.T) *FeatureFlagService {
	// Use a test Redis instance
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
	})

	// Test connection
	ctx := context.Background()
	_, err := client.Ping(ctx).Result()
	if err != nil {
		t.Skip("Redis not available for testing")
	}

	// Create service without database for basic testing
	service := &FeatureFlagService{
		redis:  client,
		logger: logrus.New(),
	}

	// Clean up before test
	client.FlushAll(ctx)

	return service
}

func TestFeatureFlagService_IsFlagEnabled(t *testing.T) {
	service := setupTestFeatureFlagService(t)

	tests := []struct {
		name     string
		flagName string
		expected bool
	}{
		{
			name:     "use_livekit_sfu default",
			flagName: FeatureUseLiveKitSFU,
			expected: DefaultUseLiveKitSFU,
		},
		{
			name:     "use_webrtc_mesh default",
			flagName: FeatureUseWebRTCMesh,
			expected: DefaultUseWebRTCMesh,
		},
		{
			name:     "enable_sfu_logs default",
			flagName: FeatureEnableSFULogs,
			expected: DefaultEnableSFULogs,
		},
		{
			name:     "unknown flag",
			flagName: "unknown_flag",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			enabled, err := service.IsFlagEnabled(tt.flagName)
			assert.NoError(t, err)
			assert.Equal(t, tt.expected, enabled)
		})
	}
}

func TestFeatureFlagService_SetFlag(t *testing.T) {
	service := setupTestFeatureFlagService(t)

	// Test setting flag to true
	err := service.SetFlag(FeatureUseLiveKitSFU, true)
	assert.NoError(t, err)

	enabled, err := service.IsFlagEnabled(FeatureUseLiveKitSFU)
	assert.NoError(t, err)
	assert.True(t, enabled)

	// Test setting flag to false
	err = service.SetFlag(FeatureUseLiveKitSFU, false)
	assert.NoError(t, err)

	enabled, err = service.IsFlagEnabled(FeatureUseLiveKitSFU)
	assert.NoError(t, err)
	assert.False(t, enabled)
}

func TestFeatureFlagService_GetFeatureConfig(t *testing.T) {
	service := setupTestFeatureFlagService(t)

	// Set some flags
	err := service.SetFlag(FeatureUseLiveKitSFU, true)
	require.NoError(t, err)
	err = service.SetFlag(FeatureUseWebRTCMesh, false)
	require.NoError(t, err)

	config, err := service.GetFeatureConfig()
	assert.NoError(t, err)
	assert.NotNil(t, config)

	assert.True(t, config.UseLiveKitSFU)
	assert.False(t, config.UseWebRTCMesh)
	assert.True(t, config.EnableSFULogs) // Default value
}

func TestFeatureFlagService_EnableLiveKitForMeeting(t *testing.T) {
	service := setupTestFeatureFlagService(t)
	meetingID := "test-meeting-123"

	// Enable LiveKit for meeting
	err := service.EnableLiveKitForMeeting(meetingID)
	assert.NoError(t, err)

	// Check if meeting should use LiveKit
	shouldUse, err := service.ShouldUseLiveKitForMeeting(meetingID)
	assert.NoError(t, err)
	assert.True(t, shouldUse)

	// Disable LiveKit for meeting
	err = service.DisableLiveKitForMeeting(meetingID)
	assert.NoError(t, err)

	// Check again
	shouldUse, err = service.ShouldUseLiveKitForMeeting(meetingID)
	assert.NoError(t, err)
	assert.False(t, shouldUse)
}

func TestFeatureFlagService_ShouldUseLiveKitForMeeting(t *testing.T) {
	service := setupTestFeatureFlagService(t)
	meetingID := "test-meeting-456"

	// Test with no meeting-specific setting (should fallback to global)
	shouldUse, err := service.ShouldUseLiveKitForMeeting(meetingID)
	assert.NoError(t, err)
	assert.Equal(t, DefaultUseLiveKitSFU, shouldUse)

	// Set meeting-specific setting
	err = service.EnableLiveKitForMeeting(meetingID)
	require.NoError(t, err)

	shouldUse, err = service.ShouldUseLiveKitForMeeting(meetingID)
	assert.NoError(t, err)
	assert.True(t, shouldUse)

	// Change global setting (should not affect meeting-specific setting)
	err = service.SetFlag(FeatureUseLiveKitSFU, false)
	require.NoError(t, err)

	shouldUse, err = service.ShouldUseLiveKitForMeeting(meetingID)
	assert.NoError(t, err)
	assert.True(t, shouldUse) // Still true because of meeting-specific setting
}

func TestFeatureFlagService_GetMigrationStats(t *testing.T) {
	service := setupTestFeatureFlagService(t)

	// Set some flags
	err := service.SetFlag(FeatureUseLiveKitSFU, true)
	require.NoError(t, err)
	err = service.SetFlag(FeatureUseWebRTCMesh, true)
	require.NoError(t, err)

	// Enable LiveKit for some meetings
	meetings := []string{"meeting-1", "meeting-2", "meeting-3"}
	for _, meetingID := range meetings {
		err = service.EnableLiveKitForMeeting(meetingID)
		require.NoError(t, err)
	}

	stats, err := service.GetMigrationStats()
	assert.NoError(t, err)
	assert.NotNil(t, stats)

	assert.Equal(t, len(meetings), stats["livekit_meeting_count"].(int64))
	assert.True(t, stats["global_livekit_enabled"].(bool))
	assert.True(t, stats["global_mesh_enabled"].(bool))
	assert.True(t, stats["sfu_logs_enabled"].(bool))
	assert.Equal(t, "parallel_testing", stats["migration_phase"].(string))
}

func TestFeatureFlagService_GetAllFlags(t *testing.T) {
	service := setupTestFeatureFlagService(t)

	// Set some flags
	err := service.SetFlag(FeatureUseLiveKitSFU, true)
	require.NoError(t, err)
	err = service.SetFlag(FeatureUseWebRTCMesh, false)
	require.NoError(t, err)

	flags, err := service.GetAllFlags()
	assert.NoError(t, err)
	assert.NotNil(t, flags)

	// Check that we have the expected flags
	assert.Contains(t, flags, FeatureUseLiveKitSFU)
	assert.Contains(t, flags, FeatureUseWebRTCMesh)
	assert.Contains(t, flags, FeatureEnableSFULogs)

	// Check values
	assert.True(t, flags[FeatureUseLiveKitSFU].Enabled)
	assert.False(t, flags[FeatureUseWebRTCMesh].Enabled)
	assert.True(t, flags[FeatureEnableSFULogs].Enabled)
}

func TestFeatureFlagService_CleanupExpiredFlags(t *testing.T) {
	service := setupTestFeatureFlagService(t)

	// Create some meeting-specific settings without expiry (simulating expired flags)
	ctx := context.Background()
	meetings := []string{"expired-meeting-1", "expired-meeting-2"}
	for _, meetingID := range meetings {
		key := "meeting_livekit:" + meetingID
		err := service.redis.Set(ctx, key, true, 0).Err() // No expiry
		require.NoError(t, err)
	}

	// Verify keys exist
	for _, meetingID := range meetings {
		key := "meeting_livekit:" + meetingID
		exists, err := service.redis.Exists(ctx, key).Result()
		require.NoError(t, err)
		assert.Equal(t, int64(1), exists)
	}

	// Run cleanup
	err := service.CleanupExpiredFlags()
	assert.NoError(t, err)

	// Verify keys are cleaned up
	for _, meetingID := range meetings {
		key := "meeting_livekit:" + meetingID
		exists, err := service.redis.Exists(ctx, key).Result()
		require.NoError(t, err)
		assert.Equal(t, int64(0), exists)
	}
}

func TestFeatureFlagService_GetFlagKey(t *testing.T) {
	service := setupTestFeatureFlagService(t)

	flagName := "test_flag"
	expectedKey := "feature_flag:test_flag"
	actualKey := service.getFlagKey(flagName)

	assert.Equal(t, expectedKey, actualKey)
}

func TestFeatureFlagService_GetFlagDescription(t *testing.T) {
	service := setupTestFeatureFlagService(t)

	tests := []struct {
		name     string
		flagName string
		expected string
	}{
		{
			name:     "use_livekit_sfu description",
			flagName: FeatureUseLiveKitSFU,
			expected: "Use LiveKit SFU for video conferencing instead of mesh WebRTC",
		},
		{
			name:     "use_webrtc_mesh description",
			flagName: FeatureUseWebRTCMesh,
			expected: "Use traditional mesh WebRTC for video conferencing",
		},
		{
			name:     "enable_sfu_logs description",
			flagName: FeatureEnableSFULogs,
			expected: "Enable detailed logging for SFU operations",
		},
		{
			name:     "unknown flag description",
			flagName: "unknown_flag",
			expected: "Feature flag",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			description := service.getFlagDescription(tt.flagName)
			assert.Equal(t, tt.expected, description)
		})
	}
}

// Integration test for migration phases
func TestFeatureFlagService_MigrationPhases(t *testing.T) {
	service := setupTestFeatureFlagService(t)

	// Test mesh_only phase
	err := service.SetFlag(FeatureUseLiveKitSFU, false)
	require.NoError(t, err)
	err = service.SetFlag(FeatureUseWebRTCMesh, true)
	require.NoError(t, err)

	stats, err := service.GetMigrationStats()
	assert.NoError(t, err)
	assert.Equal(t, "mesh_only", stats["migration_phase"].(string))

	// Test parallel_testing phase
	err = service.SetFlag(FeatureUseLiveKitSFU, true)
	require.NoError(t, err)

	stats, err = service.GetMigrationStats()
	assert.NoError(t, err)
	assert.Equal(t, "parallel_testing", stats["migration_phase"].(string))

	// Test sfu_only phase
	err = service.SetFlag(FeatureUseWebRTCMesh, false)
	require.NoError(t, err)

	stats, err = service.GetMigrationStats()
	assert.NoError(t, err)
	assert.Equal(t, "sfu_only", stats["migration_phase"].(string))
}

// Benchmark tests
func BenchmarkIsFlagEnabled(b *testing.B) {
	service := setupTestFeatureFlagService(&testing.T{})
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := service.IsFlagEnabled(FeatureUseLiveKitSFU)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSetFlag(b *testing.B) {
	service := setupTestFeatureFlagService(&testing.T{})
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		flagName := "benchmark_flag"
		enabled := i%2 == 0
		err := service.SetFlag(flagName, enabled)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkShouldUseLiveKitForMeeting(b *testing.B) {
	service := setupTestFeatureFlagService(&testing.T{})
	meetingID := "benchmark-meeting"
	
	// Set up meeting-specific setting
	err := service.EnableLiveKitForMeeting(meetingID)
	if err != nil {
		b.Fatal(err)
	}
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := service.ShouldUseLiveKitForMeeting(meetingID)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkGetMigrationStats(b *testing.B) {
	service := setupTestFeatureFlagService(&testing.T{})
	
	// Set up some test data
	err := service.SetFlag(FeatureUseLiveKitSFU, true)
	if err != nil {
		b.Fatal(err)
	}
	err = service.EnableLiveKitForMeeting("benchmark-meeting")
	if err != nil {
		b.Fatal(err)
	}
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := service.GetMigrationStats()
		if err != nil {
			b.Fatal(err)
		}
	}
}