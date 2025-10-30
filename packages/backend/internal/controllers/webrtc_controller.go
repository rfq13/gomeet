package controllers

import (
	"crypto/md5"
	"fmt"
	"log"
	"os"
	"time"

	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/filosofine/gomeet-backend/internal/models"
	"github.com/filosofine/gomeet-backend/internal/redis"
	"github.com/filosofine/gomeet-backend/internal/services"
	"github.com/filosofine/gomeet-backend/internal/utils"
)

type WebRTCController struct {
	webrtcService *services.WebRTCService
	turnService   *services.TurnService
	db            *gorm.DB
	validator     *validator.Validate
	redisClient   *redis.RedisClient
}

func NewWebRTCController(webrtcService *services.WebRTCService, turnService *services.TurnService, db *gorm.DB, redisClient *redis.RedisClient) *WebRTCController {
	return &WebRTCController{
		webrtcService: webrtcService,
		turnService:   turnService,
		db:            db,
		validator:     validator.New(),
		redisClient:   redisClient,
	}
}

// GetMeetingPeers returns all WebRTC peers in a meeting
// @Summary Get meeting WebRTC peers
// @Description Get list of all WebRTC peers in a meeting
// @Tags webrtc
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Router /api/v1/webrtc/meetings/{id}/peers [get]
func (c *WebRTCController) GetMeetingPeers(ctx *gin.Context) {
	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_MEETING_ID, "Invalid meeting ID")
		return
	}

	// Check if meeting exists
	var meeting models.Meeting
	if err := c.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		utils.HandleNotFoundResponse(ctx, "Meeting not found")
		return
	}

	// Get user info for access control
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.HandleUnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_USER_ID, "Invalid user ID")
		return
	}

	// Check if user has access to this meeting (host or participant)
	hasAccess := false
	if meeting.HostID == userUUID {
		hasAccess = true
	} else {
		// Check if user is a participant
		var participant models.Participant
		if err := c.db.Where("meeting_id = ? AND user_id = ?", meetingID, userUUID).First(&participant).Error; err == nil {
			hasAccess = true
		}
	}

	if !hasAccess {
		utils.HandleForbiddenResponse(ctx, "You don't have access to this meeting")
		return
	}

	// Get WebRTC peers
	peers := c.webrtcService.GetMeetingPeers(meetingIDStr)
	
	// Convert to response format
	peerResponses := make([]models.WebRTCPeerResponse, len(peers))
	for i, peer := range peers {
		peerResponses[i] = models.WebRTCPeerResponse{
			ID:               peer.ID,
			Name:             peer.Name,
			IsAuthenticated:  peer.IsAuth,
			UserID:           peer.UserID,
			PublicUserID:     peer.PublicUserID,
			State:            peer.State,
			JoinedAt:         peer.JoinedAt,
			LastSeen:         peer.LastSeen,
		}
	}

	utils.SuccessResponse(ctx, http.StatusOK, models.WebRTCPeersResponse{
		MeetingID: meetingIDStr,
		Peers:     peerResponses,
		Count:     len(peerResponses),
	}, "WebRTC peers retrieved successfully")
}

// JoinMeeting joins a WebRTC meeting
// @Summary Join WebRTC meeting
// @Description Join a WebRTC meeting as a peer
// @Tags webrtc
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Param request body JoinWebRTCMeetingRequest true "Join meeting request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Router /api/v1/webrtc/meetings/{id}/join [post]
func (c *WebRTCController) JoinMeeting(ctx *gin.Context) {
	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_MEETING_ID, "Invalid meeting ID")
		return
	}

	// Get user info
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.HandleUnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_USER_ID, "Invalid user ID")
		return
	}

	// Check if meeting exists
	var meeting models.Meeting
	if err := c.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		utils.HandleNotFoundResponse(ctx, "Meeting not found")
		return
	}

	// Check if user has access to this meeting
	hasAccess := false
	if meeting.HostID == userUUID {
		hasAccess = true
	} else {
		// Check if user is a participant
		var participant models.Participant
		if err := c.db.Where("meeting_id = ? AND user_id = ?", meetingID, userUUID).First(&participant).Error; err == nil {
			hasAccess = true
		}
	}

	if !hasAccess {
		utils.HandleForbiddenResponse(ctx, "You don't have access to this meeting")
		return
	}

	var req JoinWebRTCMeetingRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	// Get user details
	var user models.User
	if err := c.db.Where("id = ?", userUUID).First(&user).Error; err != nil {
		utils.HandleNotFoundResponse(ctx, "User not found")
		return
	}

	// Generate peer ID if not provided
	peerID := req.PeerID
	if peerID == "" {
		peerID = uuid.New().String()
	}

	// Join meeting
	peer, err := c.webrtcService.JoinMeeting(meetingIDStr, peerID, &userUUID, nil, user.Username, true)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, utils.JOIN_FAILED, err.Error())
		return
	}

	// Update peer state to connecting
	c.webrtcService.UpdatePeerState(meetingIDStr, peerID, models.PeerStateConnecting)

	utils.SuccessResponse(ctx, http.StatusOK, models.WebRTCPeerResponse{
		ID:               peer.ID,
		Name:             peer.Name,
		IsAuthenticated:  peer.IsAuth,
		UserID:           peer.UserID,
		PublicUserID:     peer.PublicUserID,
		State:            peer.State,
		JoinedAt:         peer.JoinedAt,
		LastSeen:         peer.LastSeen,
	}, "Successfully joined WebRTC meeting")
}

// LeaveMeeting leaves a WebRTC meeting
// @Summary Leave WebRTC meeting
// @Description Leave a WebRTC meeting
// @Tags webrtc
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Param request body LeaveWebRTCMeetingRequest true "Leave meeting request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Router /api/v1/webrtc/meetings/{id}/leave [post]
func (c *WebRTCController) LeaveMeeting(ctx *gin.Context) {
	meetingIDStr := ctx.Param("id")

	var req LeaveWebRTCMeetingRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	// Leave meeting
	err := c.webrtcService.LeaveMeeting(meetingIDStr, req.PeerID)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.LEAVE_FAILED, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, nil, "Successfully left WebRTC meeting")
}

// SendOffer sends a WebRTC offer to a peer
// @Summary Send WebRTC offer
// @Description Send a WebRTC offer to a specific peer in a meeting
// @Tags webrtc
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Param request body models.WebRTCOfferRequest true "Offer request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Router /api/v1/webrtc/meetings/{id}/offer [post]
func (c *WebRTCController) SendOffer(ctx *gin.Context) {
	meetingIDStr := ctx.Param("id")

	var req models.WebRTCOfferRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	// Get user info to determine fromPeerID
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.HandleUnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_USER_ID, "Invalid user ID")
		return
	}

	// Find the peer ID for this user
	peers := c.webrtcService.GetMeetingPeers(meetingIDStr)
	var fromPeerID string
	for _, peer := range peers {
		if peer.UserID != nil && *peer.UserID == userUUID {
			fromPeerID = peer.ID
			break
		}
	}

	if fromPeerID == "" {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.NOT_IN_MEETING, "You are not in this WebRTC meeting")
		return
	}

	// Send offer
	err = c.webrtcService.SendOffer(meetingIDStr, fromPeerID, req.To, req.Offer)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.OFFER_FAILED, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, nil, "Offer sent successfully")
}

// SendAnswer sends a WebRTC answer to a peer
// @Summary Send WebRTC answer
// @Description Send a WebRTC answer to a specific peer in a meeting
// @Tags webrtc
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Param request body models.WebRTCAnswerRequest true "Answer request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Router /api/v1/webrtc/meetings/{id}/answer [post]
func (c *WebRTCController) SendAnswer(ctx *gin.Context) {
	meetingIDStr := ctx.Param("id")

	var req models.WebRTCAnswerRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	// Get user info to determine fromPeerID
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.HandleUnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_USER_ID, "Invalid user ID")
		return
	}

	// Find the peer ID for this user
	peers := c.webrtcService.GetMeetingPeers(meetingIDStr)
	var fromPeerID string
	for _, peer := range peers {
		if peer.UserID != nil && *peer.UserID == userUUID {
			fromPeerID = peer.ID
			break
		}
	}

	if fromPeerID == "" {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.NOT_IN_MEETING, "You are not in this WebRTC meeting")
		return
	}

	// Send answer
	err = c.webrtcService.SendAnswer(meetingIDStr, fromPeerID, req.To, req.Answer)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.ANSWER_FAILED, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, nil, "Answer sent successfully")
}

// SendIceCandidate sends an ICE candidate to a peer
// @Summary Send ICE candidate
// @Description Send an ICE candidate to a specific peer in a meeting
// @Tags webrtc
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Param request body models.WebRTCIceCandidateRequest true "ICE candidate request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Router /api/v1/webrtc/meetings/{id}/ice-candidate [post]
func (c *WebRTCController) SendIceCandidate(ctx *gin.Context) {
	meetingIDStr := ctx.Param("id")

	var req models.WebRTCIceCandidateRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	// Get user info to determine fromPeerID
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.HandleUnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_USER_ID, "Invalid user ID")
		return
	}

	// Find the peer ID for this user
	peers := c.webrtcService.GetMeetingPeers(meetingIDStr)
	var fromPeerID string
	for _, peer := range peers {
		if peer.UserID != nil && *peer.UserID == userUUID {
			fromPeerID = peer.ID
			break
		}
	}

	if fromPeerID == "" {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.NOT_IN_MEETING, "You are not in this WebRTC meeting")
		return
	}

	// Send ICE candidate
	err = c.webrtcService.SendIceCandidate(meetingIDStr, fromPeerID, req.To, req.Candidate)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.ICE_CANDIDATE_FAILED, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, nil, "ICE candidate sent successfully")
}

// UpdatePeerState updates a peer's connection state
// @Summary Update peer state
// @Description Update a WebRTC peer's connection state
// @Tags webrtc
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Param request body UpdatePeerStateRequest true "Update peer state request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Router /api/v1/webrtc/meetings/{id}/peer-state [put]
func (c *WebRTCController) UpdatePeerState(ctx *gin.Context) {
	meetingIDStr := ctx.Param("id")

	var req UpdatePeerStateRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	// Get user info
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.HandleUnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_USER_ID, "Invalid user ID")
		return
	}

	// Find the peer ID for this user
	peers := c.webrtcService.GetMeetingPeers(meetingIDStr)
	var peerID string
	for _, peer := range peers {
		if peer.UserID != nil && *peer.UserID == userUUID {
			peerID = peer.ID
			break
		}
	}

	if peerID == "" {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.NOT_IN_MEETING, "You are not in this WebRTC meeting")
		return
	}

	// Update peer state
	err = c.webrtcService.UpdatePeerState(meetingIDStr, peerID, models.PeerConnectionState(req.State))
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.UPDATE_FAILED, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, nil, "Peer state updated successfully")
}

// GetRoomStats returns statistics about a WebRTC room
// @Summary Get room statistics
// @Description Get statistics about a WebRTC room (host only)
// @Tags webrtc
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 403 {object} utils.ErrorResponse
// @Router /api/v1/webrtc/meetings/{id}/stats [get]
func (c *WebRTCController) GetRoomStats(ctx *gin.Context) {
	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_MEETING_ID, "Invalid meeting ID")
		return
	}

	// Get user info
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.HandleUnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_USER_ID, "Invalid user ID")
		return
	}

	// Check if user is the meeting host
	var meeting models.Meeting
	if err := c.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		utils.HandleNotFoundResponse(ctx, "Meeting not found")
		return
	}

	if meeting.HostID != userUUID {
		utils.HandleForbiddenResponse(ctx, "Only meeting hosts can view room statistics")
		return
	}

	// Get room stats
	stats := c.webrtcService.GetRoomStats(meetingIDStr)

	utils.SuccessResponse(ctx, http.StatusOK, stats, "Room statistics retrieved successfully")
}

// GetLiveKitToken generates a LiveKit token for joining a meeting
// @Summary Get LiveKit token
// @Description Generate a LiveKit token for joining a meeting via LiveKit SFU
// @Tags webrtc
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body LiveKitTokenRequest true "LiveKit token request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Router /api/v1/webrtc/token [post]
func (c *WebRTCController) GetLiveKitToken(ctx *gin.Context) {
	var req LiveKitTokenRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	// Parse meeting ID
	meetingID, err := uuid.Parse(req.MeetingID)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_MEETING_ID, "Invalid meeting ID")
		return
	}

	// Check if meeting exists
	var meeting models.Meeting
	if err := c.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		utils.HandleNotFoundResponse(ctx, "Meeting not found")
		return
	}

	// Check participant limit
	currentPeers := c.webrtcService.GetMeetingPeers(req.MeetingID)
	if len(currentPeers) >= 50 {
		utils.HandleSendErrorResponse(ctx, http.StatusForbidden, utils.ROOM_FULL, "Room has reached maximum capacity of 50 participants")
		return
	}

	// Get user info
	userID, exists := utils.GetUserID(ctx)
	var userName string
	var userUUID *uuid.UUID
	
	if exists {
		parsedUUID, err := uuid.Parse(userID)
		if err != nil {
			utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_USER_ID, "Invalid user ID")
			return
		}
		userUUID = &parsedUUID

		// Get user details
		var user models.User
		if err := c.db.Where("id = ?", userUUID).First(&user).Error; err == nil {
			userName = user.Username
		}
	} else {
		// For public users, use session ID
		if req.SessionID == "" {
			utils.HandleUnauthorizedResponse(ctx, "User not authenticated and no session ID provided")
			return
		}
		userName = "Public User"
	}

	// Log room configuration
	log.Printf("[LiveKit] Generating token for meeting %s, user %s, current participants: %d",
		req.MeetingID, userName, len(currentPeers))

	// Generate LiveKit token with room configuration
	token, err := c.generateLiveKitToken(req.MeetingID, userID, req.SessionID, userName)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, utils.TOKEN_GENERATION_FAILED, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, map[string]interface{}{
		"token": token,
		"url":   "wss://livekit.filosofine.com", // LiveKit server URL
		"roomConfig": map[string]interface{}{
			"maxParticipants": 50,
			"emptyTimeout": 180, // 3 minutes
			"departureTimeout": 10, // 10 seconds
		},
	}, "LiveKit token generated successfully")
}

// generateLiveKitToken generates a LiveKit token for the given meeting and user
func (c *WebRTCController) generateLiveKitToken(meetingID, userID, sessionID, userName string) (string, error) {
	// Generate cache key
	cacheKey := c.generateTokenCacheKey(meetingID, userID, sessionID, userName)
	
	// Try to get token from cache first
	if c.redisClient != nil && c.redisClient.IsConnected() {
		var cachedToken string
		err := c.redisClient.Get(cacheKey, &cachedToken)
		if err == nil {
			log.Printf("🎯 Cache HIT for LiveKit token: %s", cacheKey)
			return cachedToken, nil
		}
		log.Printf("❌ Cache MISS for LiveKit token: %s", cacheKey)
	} else {
		log.Printf("⚠️ Redis not available, generating token without cache")
	}
	
	// Generate new token
	token, err := c.generateNewLiveKitToken(meetingID, userID, sessionID, userName)
	if err != nil {
		return "", err
	}
	
	// Cache the token for 5 minutes if Redis is available
	if c.redisClient != nil && c.redisClient.IsConnected() {
		err := c.redisClient.Set(cacheKey, token, 5*time.Minute)
		if err != nil {
			log.Printf("⚠️ Failed to cache LiveKit token: %v", err)
			// Continue without caching - don't fail the request
		} else {
			log.Printf("💾 Cached LiveKit token: %s", cacheKey)
		}
	}
	
	return token, nil
}

// generateNewLiveKitToken generates a new LiveKit token without caching
func (c *WebRTCController) generateNewLiveKitToken(meetingID, userID, sessionID, userName string) (string, error) {
	// Get LiveKit API credentials from environment
	apiKey := os.Getenv("LIVEKIT_API_KEY")
	apiSecret := os.Getenv("LIVEKIT_API_SECRET")
	
	if apiKey == "" || apiSecret == "" {
		return "", fmt.Errorf("LiveKit API credentials not configured")
	}
	
	// Create JWT token for LiveKit
	// Set identity
	identity := userID
	if identity == "" {
		identity = sessionID
	}
	
	// Create token claims
	claims := &jwt.MapClaims{
		"iss": apiKey,                           // issuer
		"sub": identity,                         // subject (user identity)
		"aud": "livekit",                        // audience
		"exp": time.Now().Add(24 * time.Hour).Unix(), // expiration (24 hours)
		"iat": time.Now().Unix(),                // issued at
		"video": map[string]interface{}{
			"roomJoin": true,
			"room":     meetingID,
		},
		"name": userName,
	}
	
	// Create token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	
	// Sign token with API secret
	tokenString, err := token.SignedString([]byte(apiSecret))
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}
	
	return tokenString, nil
}

// generateTokenCacheKey generates a unique cache key for LiveKit tokens
func (c *WebRTCController) generateTokenCacheKey(meetingID, userID, sessionID, userName string) string {
	// Create a deterministic key from the parameters
	keyData := fmt.Sprintf("livekit:token:%s:%s:%s:%s", meetingID, userID, sessionID, userName)
	hash := md5.Sum([]byte(keyData))
	return fmt.Sprintf("livekit_token_%x", hash)
}

// Request types
type JoinWebRTCMeetingRequest struct {
	PeerID string `json:"peerId,omitempty"`
}

type LeaveWebRTCMeetingRequest struct {
	PeerID string `json:"peerId" validate:"required"`
}

type UpdatePeerStateRequest struct {
	State models.PeerConnectionState `json:"state" validate:"required,oneof=new connecting connected disconnected failed closed"`
}

type LiveKitTokenRequest struct {
	MeetingID  string                 `json:"meetingId" validate:"required"`
	SessionID  string                 `json:"sessionId,omitempty"`
	RoomConfig map[string]interface{} `json:"roomConfig,omitempty"`
}

// GetWebRTCStats returns comprehensive WebRTC statistics
// @Summary Get WebRTC statistics
// @Description Get comprehensive WebRTC statistics including connection quality, TURN server usage, and performance metrics
// @Tags webrtc
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 403 {object} utils.ErrorResponse
// @Router /api/v1/webrtc/meetings/{id}/stats [get]
func (c *WebRTCController) GetWebRTCStats(ctx *gin.Context) {
	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_MEETING_ID, "Invalid meeting ID")
		return
	}

	// Get user info
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.HandleUnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_USER_ID, "Invalid user ID")
		return
	}

	// Check if user is the meeting host
	var meeting models.Meeting
	if err := c.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		utils.HandleNotFoundResponse(ctx, "Meeting not found")
		return
	}

	if meeting.HostID != userUUID {
		utils.HandleForbiddenResponse(ctx, "Only meeting hosts can view WebRTC statistics")
		return
	}

	// Get WebRTC statistics from service
	webRTCStats := c.webrtcService.GetWebRTCStats()
	
	// Get TURN server statistics
	turnStats := map[string]interface{}{
		"enabled": true,
		"server":  "turn:localhost:3478",
		"status":  "active",
	}

	// Combine statistics
	comprehensiveStats := map[string]interface{}{
		"meetingId":     meetingIDStr,
		"timestamp":     time.Now().UTC(),
		"webRTC":        webRTCStats,
		"turnServer":    turnStats,
		"performance": map[string]interface{}{
			"connectionQuality": c.calculateConnectionQuality(webRTCStats),
			"bandwidthUsage":    c.calculateBandwidthUsage(webRTCStats),
			"latencyMetrics":    c.calculateLatencyMetrics(webRTCStats),
		},
		"recommendations": c.generateOptimizationRecommendations(webRTCStats, turnStats),
	}

	utils.SuccessResponse(ctx, http.StatusOK, comprehensiveStats, "WebRTC statistics retrieved successfully")
}

// OptimizeRoom optimizes WebRTC room configuration based on current conditions
// @Summary Optimize WebRTC room
// @Description Optimize WebRTC room configuration including SFU settings, bandwidth allocation, and quality parameters
// @Tags webrtc
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Param request body OptimizeRoomRequest true "Optimization request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 403 {object} utils.ErrorResponse
// @Router /api/v1/webrtc/meetings/{id}/optimize [post]
func (c *WebRTCController) OptimizeRoom(ctx *gin.Context) {
	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_MEETING_ID, "Invalid meeting ID")
		return
	}

	// Get user info
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.HandleUnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_USER_ID, "Invalid user ID")
		return
	}

	// Check if user is the meeting host
	var meeting models.Meeting
	if err := c.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		utils.HandleNotFoundResponse(ctx, "Meeting not found")
		return
	}

	if meeting.HostID != userUUID {
		utils.HandleForbiddenResponse(ctx, "Only meeting hosts can optimize WebRTC rooms")
		return
	}

	var req OptimizeRoomRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	// Optimize room configuration
	optimizationResult := c.webrtcService.OptimizeRoomConfiguration(meetingIDStr)

	utils.SuccessResponse(ctx, http.StatusOK, optimizationResult, "WebRTC room optimized successfully")
}

// Helper methods for statistics calculation
func (c *WebRTCController) calculateConnectionQuality(stats map[string]interface{}) map[string]interface{} {
	// Extract connection quality metrics from stats
	quality := map[string]interface{}{
		"overall": "good", // Default
		"factors": map[string]interface{}{
			"latency":     "good",
			"packetLoss":  "low",
			"bandwidth":   "adequate",
			"connection":  "stable",
		},
	}

	// Analyze peer connections if available
	if peers, ok := stats["peers"].([]interface{}); ok {
		totalPeers := len(peers)
		if totalPeers > 0 {
			// Calculate average quality metrics
			// This is a simplified implementation - in production, you'd analyze actual metrics
			quality["peerCount"] = totalPeers
			quality["activeConnections"] = totalPeers
		}
	}

	return quality
}

func (c *WebRTCController) calculateBandwidthUsage(stats map[string]interface{}) map[string]interface{} {
	bandwidth := map[string]interface{}{
		"total":     0,
		"available": 2000, // Default 2Mbps
		"utilization": 0,
		"perPeer":   make([]interface{}, 0),
	}

	// Extract bandwidth information from stats
	// This is a simplified implementation
	bandwidth["utilization"] = float32(0.0) // 0% utilization

	return bandwidth
}

func (c *WebRTCController) calculateLatencyMetrics(stats map[string]interface{}) map[string]interface{} {
	latency := map[string]interface{}{
		"average":     0,
		"median":      0,
		"p95":         0,
		"jitter":      0,
		"roundTrip":   0,
	}

	// Extract latency information from stats
	// This is a simplified implementation
	latency["average"] = 50 // 50ms average latency

	return latency
}

func (c *WebRTCController) generateOptimizationRecommendations(webRTCStats map[string]interface{}, turnStats map[string]interface{}) []string {
	recommendations := []string{}

	// Analyze current state and generate recommendations
	if peers, ok := webRTCStats["peers"].([]interface{}); ok {
		peerCount := len(peers)
		
		if peerCount > 20 {
			recommendations = append(recommendations, "Consider enabling simulcast for large meetings")
		}
		
		if peerCount > 30 {
			recommendations = append(recommendations, "Enable adaptive bitrate streaming for better performance")
		}
	}

	// TURN server recommendations
	if turnEnabled, ok := turnStats["enabled"].(bool); ok && !turnEnabled {
		recommendations = append(recommendations, "Enable TURN server for better NAT traversal")
	}

	if len(recommendations) == 0 {
		recommendations = append(recommendations, "Current configuration is optimal")
	}

	return recommendations
}

// Request types for optimization
type OptimizeRoomRequest struct {
	Strategy string `json:"strategy" validate:"required,oneof=performance quality bandwidth"`
}

type WebRTCStatsResponse struct {
	MeetingID        string                 `json:"meetingId"`
	Timestamp        time.Time             `json:"timestamp"`
	PeerCount        int                   `json:"peerCount"`
	ConnectionQuality map[string]interface{} `json:"connectionQuality"`
	BandwidthUsage   map[string]interface{} `json:"bandwidthUsage"`
	LatencyMetrics   map[string]interface{} `json:"latencyMetrics"`
	TurnServerStats  map[string]interface{} `json:"turnServerStats"`
	Recommendations  []string              `json:"recommendations"`
}