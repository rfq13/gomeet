package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/your-org/gomeet-backend/internal/models"
	"github.com/your-org/gomeet-backend/internal/services"
	"github.com/your-org/gomeet-backend/internal/utils"
)

type WebRTCController struct {
	webrtcService *services.WebRTCService
	db            *gorm.DB
	validator     *validator.Validate
}

func NewWebRTCController(webrtcService *services.WebRTCService, db *gorm.DB) *WebRTCController {
	return &WebRTCController{
		webrtcService: webrtcService,
		db:            db,
		validator:     validator.New(),
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
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	// Check if meeting exists
	var meeting models.Meeting
	if err := c.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		utils.NotFoundResponse(ctx, "Meeting not found")
		return
	}

	// Get user info for access control
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
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
		utils.ForbiddenResponse(ctx, "You don't have access to this meeting")
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
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	// Get user info
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	// Check if meeting exists
	var meeting models.Meeting
	if err := c.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		utils.NotFoundResponse(ctx, "Meeting not found")
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
		utils.ForbiddenResponse(ctx, "You don't have access to this meeting")
		return
	}

	var req JoinWebRTCMeetingRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	// Get user details
	var user models.User
	if err := c.db.Where("id = ?", userUUID).First(&user).Error; err != nil {
		utils.SendErrorResponse(ctx, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
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
		utils.SendErrorResponse(ctx, http.StatusInternalServerError, "JOIN_FAILED", err.Error())
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
		utils.ValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	// Leave meeting
	err := c.webrtcService.LeaveMeeting(meetingIDStr, req.PeerID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "LEAVE_FAILED", err.Error())
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
		utils.ValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	// Get user info to determine fromPeerID
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
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
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "NOT_IN_MEETING", "You are not in this WebRTC meeting")
		return
	}

	// Send offer
	err = c.webrtcService.SendOffer(meetingIDStr, fromPeerID, req.To, req.Offer)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "OFFER_FAILED", err.Error())
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
		utils.ValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	// Get user info to determine fromPeerID
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
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
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "NOT_IN_MEETING", "You are not in this WebRTC meeting")
		return
	}

	// Send answer
	err = c.webrtcService.SendAnswer(meetingIDStr, fromPeerID, req.To, req.Answer)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "ANSWER_FAILED", err.Error())
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
		utils.ValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	// Get user info to determine fromPeerID
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
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
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "NOT_IN_MEETING", "You are not in this WebRTC meeting")
		return
	}

	// Send ICE candidate
	err = c.webrtcService.SendIceCandidate(meetingIDStr, fromPeerID, req.To, req.Candidate)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "ICE_CANDIDATE_FAILED", err.Error())
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
		utils.ValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	// Get user info
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
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
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "NOT_IN_MEETING", "You are not in this WebRTC meeting")
		return
	}

	// Update peer state
	err = c.webrtcService.UpdatePeerState(meetingIDStr, peerID, models.PeerConnectionState(req.State))
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "UPDATE_FAILED", err.Error())
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
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	// Get user info
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.UnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	// Check if user is the meeting host
	var meeting models.Meeting
	if err := c.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
		utils.NotFoundResponse(ctx, "Meeting not found")
		return
	}

	if meeting.HostID != userUUID {
		utils.ForbiddenResponse(ctx, "Only meeting hosts can view room statistics")
		return
	}

	// Get room stats
	stats := c.webrtcService.GetRoomStats(meetingIDStr)

	utils.SuccessResponse(ctx, http.StatusOK, stats, "Room statistics retrieved successfully")
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