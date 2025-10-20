package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/your-org/gomeet/packages/backend/internal/config"
	"github.com/your-org/gomeet/packages/backend/internal/models"
	"github.com/your-org/gomeet/packages/backend/internal/routes"
)

func setupTestRouter(t *testing.T) (*gin.Engine, *gorm.DB) {
	gin.SetMode(gin.TestMode)

	// Setup in-memory database
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)

	// Migrate all tables
	err = db.AutoMigrate(
		&models.User{},
		&models.Meeting{},
		&models.Participant{},
	)
	require.NoError(t, err)

	// Create test configuration
	cfg := config.Config{
		Server: config.ServerConfig{
			Port:   "8080",
			GinMode: "test",
		},
		LiveKit: config.LiveKitConfig{
			Host:      "localhost:7880",
			APIKey:    "test-api-key",
			APISecret: "test-api-secret",
		},
		Redis: config.RedisConfig{
			Host:     "localhost",
			Port:     "6379",
			Password: "",
		},
	}

	// Setup router
	router := routes.Setup(db, cfg)

	return router, db
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

func TestLiveKitIntegration_CreateRoom(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	router, db := setupTestRouter(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)

	// Prepare request
	reqBody := map[string]string{
		"meeting_id": meeting.ID.String(),
	}
	body, _ := json.Marshal(reqBody)

	req, _ := http.NewRequest("POST", "/api/v1/livekit/rooms/"+meeting.ID.String()+"/create", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	// Create response recorder
	w := httptest.NewRecorder()

	// Serve the request
	router.ServeHTTP(w, req)

	// Check response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.True(t, response["success"].(bool))
	assert.NotNil(t, response["data"])
}

func TestLiveKitIntegration_JoinRoom(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	router, db := setupTestRouter(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)
	participant := createTestParticipant(t, db, meeting.ID, user.ID)

	// Prepare request
	reqBody := map[string]string{
		"participant_id": participant.ID.String(),
		"meeting_id":     meeting.ID.String(),
	}
	body, _ := json.Marshal(reqBody)

	req, _ := http.NewRequest("POST", "/api/v1/livekit/rooms/"+meeting.ID.String()+"/join", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	// Create response recorder
	w := httptest.NewRecorder()

	// Serve the request
	router.ServeHTTP(w, req)

	// Check response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.True(t, response["success"].(bool))
	assert.NotNil(t, response["data"])

	data := response["data"].(map[string]interface{})
	assert.NotEmpty(t, data["token"])
	assert.NotEmpty(t, data["room_id"])
	assert.NotEmpty(t, data["server_url"])
}

func TestLiveKitIntegration_GetParticipants(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	router, db := setupTestRouter(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)
	_ = createTestParticipant(t, db, meeting.ID, user.ID)

	req, _ := http.NewRequest("GET", "/api/v1/livekit/rooms/"+meeting.ID.String()+"/participants", nil)

	// Create response recorder
	w := httptest.NewRecorder()

	// Serve the request
	router.ServeHTTP(w, req)

	// Check response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.True(t, response["success"].(bool))
	assert.NotNil(t, response["data"])

	data := response["data"].([]interface{})
	assert.Len(t, data, 1) // Should have one participant
}

func TestLiveKitIntegration_LeaveRoom(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	router, db := setupTestRouter(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)
	participant := createTestParticipant(t, db, meeting.ID, user.ID)

	// Prepare request
	reqBody := map[string]string{
		"participant_id": participant.ID.String(),
		"meeting_id":     meeting.ID.String(),
	}
	body, _ := json.Marshal(reqBody)

	req, _ := http.NewRequest("POST", "/api/v1/livekit/rooms/"+meeting.ID.String()+"/leave", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	// Create response recorder
	w := httptest.NewRecorder()

	// Serve the request
	router.ServeHTTP(w, req)

	// Check response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.True(t, response["success"].(bool))
}

func TestLiveKitIntegration_DeleteRoom(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	router, db := setupTestRouter(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)

	req, _ := http.NewRequest("DELETE", "/api/v1/livekit/rooms/"+meeting.ID.String(), nil)

	// Create response recorder
	w := httptest.NewRecorder()

	// Serve the request
	router.ServeHTTP(w, req)

	// Check response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.True(t, response["success"].(bool))
}

func TestLiveKitIntegration_GetRoomStatus(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	router, db := setupTestRouter(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)

	req, _ := http.NewRequest("GET", "/api/v1/livekit/rooms/"+meeting.ID.String()+"/status", nil)

	// Create response recorder
	w := httptest.NewRecorder()

	// Serve the request
	router.ServeHTTP(w, req)

	// Check response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.True(t, response["success"].(bool))
	assert.NotNil(t, response["data"])

	data := response["data"].(map[string]interface{})
	assert.Contains(t, data, "is_active")
	assert.Contains(t, data, "participant_count")
	assert.Contains(t, data, "room_id")
}

func TestLiveKitIntegration_GetParticipantCount(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	router, db := setupTestRouter(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)

	req, _ := http.NewRequest("GET", "/api/v1/livekit/rooms/"+meeting.ID.String()+"/count", nil)

	// Create response recorder
	w := httptest.NewRecorder()

	// Serve the request
	router.ServeHTTP(w, req)

	// Check response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.True(t, response["success"].(bool))
	assert.NotNil(t, response["data"])

	data := response["data"].(map[string]interface{})
	assert.Contains(t, data, "participant_count")
	assert.Contains(t, data, "room_id")
}

func TestFeatureFlagIntegration_GetConfig(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	router, _ := setupTestRouter(t)

	req, _ := http.NewRequest("GET", "/api/v1/feature-flags/config", nil)

	// Create response recorder
	w := httptest.NewRecorder()

	// Serve the request
	router.ServeHTTP(w, req)

	// Check response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.True(t, response["success"].(bool))
	assert.NotNil(t, response["data"])

	data := response["data"].(map[string]interface{})
	assert.Contains(t, data, "use_livekit_sfu")
	assert.Contains(t, data, "use_webrtc_mesh")
	assert.Contains(t, data, "enable_sfu_logs")
}

func TestFeatureFlagIntegration_SetFlag(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	router, _ := setupTestRouter(t)

	// Prepare request
	reqBody := map[string]interface{}{
		"flag_name": "use_livekit_sfu",
		"enabled":   true,
	}
	body, _ := json.Marshal(reqBody)

	req, _ := http.NewRequest("POST", "/api/v1/feature-flags/set", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	// Create response recorder
	w := httptest.NewRecorder()

	// Serve the request
	router.ServeHTTP(w, req)

	// Check response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.True(t, response["success"].(bool))
	assert.NotNil(t, response["data"])
}

func TestFeatureFlagIntegration_EnableLiveKitForMeeting(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	router, db := setupTestRouter(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)

	// Prepare request
	reqBody := map[string]interface{}{
		"meeting_id": meeting.ID.String(),
		"enabled":    true,
	}
	body, _ := json.Marshal(reqBody)

	req, _ := http.NewRequest("POST", "/api/v1/feature-flags/meetings/livekit/enable", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	// Create response recorder
	w := httptest.NewRecorder()

	// Serve the request
	router.ServeHTTP(w, req)

	// Check response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.True(t, response["success"].(bool))
	assert.NotNil(t, response["data"])
}

func TestFeatureFlagIntegration_ShouldUseLiveKitForMeeting(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	router, db := setupTestRouter(t)
	user := createTestUser(t, db)
	meeting := createTestMeeting(t, db, user.ID)

	req, _ := http.NewRequest("GET", "/api/v1/feature-flags/meetings/"+meeting.ID.String()+"/livekit", nil)

	// Create response recorder
	w := httptest.NewRecorder()

	// Serve the request
	router.ServeHTTP(w, req)

	// Check response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.True(t, response["success"].(bool))
	assert.NotNil(t, response["data"])

	data := response["data"].(map[string]interface{})
	assert.Contains(t, data, "meeting_id")
	assert.Contains(t, data, "should_use")
	assert.Contains(t, data, "architecture")
}

func TestFeatureFlagIntegration_GetMigrationStats(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	router, _ := setupTestRouter(t)

	req, _ := http.NewRequest("GET", "/api/v1/feature-flags/migration/stats", nil)

	// Create response recorder
	w := httptest.NewRecorder()

	// Serve the request
	router.ServeHTTP(w, req)

	// Check response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.True(t, response["success"].(bool))
	assert.NotNil(t, response["data"])

	data := response["data"].(map[string]interface{})
	assert.Contains(t, data, "livekit_meeting_count")
	assert.Contains(t, data, "global_livekit_enabled")
	assert.Contains(t, data, "global_mesh_enabled")
	assert.Contains(t, data, "migration_phase")
}

// Benchmark tests
func BenchmarkLiveKitCreateRoom(b *testing.B) {
	if testing.Short() {
		b.Skip("Skipping benchmark test in short mode")
	}

	router, db := setupTestRouter(&testing.T{})
	user := createTestUser(&testing.T{}, db)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		meeting := createTestMeeting(&testing.T{}, db, user.ID)

		reqBody := map[string]string{
			"meeting_id": meeting.ID.String(),
		}
		body, _ := json.Marshal(reqBody)

		req, _ := http.NewRequest("POST", "/api/v1/livekit/rooms/"+meeting.ID.String()+"/create", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			b.Fatalf("Expected status 200, got %d", w.Code)
		}
	}
}

func BenchmarkFeatureFlagGetConfig(b *testing.B) {
	if testing.Short() {
		b.Skip("Skipping benchmark test in short mode")
	}

	router, _ := setupTestRouter(&testing.T{})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req, _ := http.NewRequest("GET", "/api/v1/feature-flags/config", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			b.Fatalf("Expected status 200, got %d", w.Code)
		}
	}
}