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

type WebSocketController struct {
	websocketService *services.WebSocketService
	db               *gorm.DB
	validator        *validator.Validate
}

func NewWebSocketController(websocketService *services.WebSocketService, db *gorm.DB) *WebSocketController {
	return &WebSocketController{
		websocketService: websocketService,
		db:               db,
		validator:        validator.New(),
	}
}

// HandleWebSocket handles WebSocket connections for meeting rooms
// @Summary Connect to WebSocket for meeting
// @Description Establish WebSocket connection for real-time communication in a meeting room
// @Tags websocket
// @Param id path string true "Meeting ID"
// @Param clientId query string false "Client ID (optional, will be generated if not provided)"
// @Param sessionId query string false "Session ID for public users"
// @Security BearerAuth
// @Success 101 {string} string "WebSocket connection established"
// @Failure 400 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Router /api/v1/ws/meetings/{id} [get]
func (c *WebSocketController) HandleWebSocket(ctx *gin.Context) {
	c.websocketService.HandleWebSocket(ctx)
}

// GetMeetingParticipants returns active WebSocket participants for a meeting
// @Summary Get meeting participants
// @Description Get list of active WebSocket participants in a meeting
// @Tags websocket
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Router /api/v1/ws/meetings/{id}/participants [get]
func (c *WebSocketController) GetMeetingParticipants(ctx *gin.Context) {
	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

	// Check if meeting exists and user has access
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

	// Verify user has access to this meeting (either host or participant)
	// This is a simplified check - in production you might want more sophisticated access control
	participants := c.websocketService.GetMeetingParticipants(meetingIDStr)
	
	// Check if user is in the WebSocket participants
	userInMeeting := false
	for _, participant := range participants {
		if participant.UserID != nil && *participant.UserID == userUUID {
			userInMeeting = true
			break
		}
	}

	if !userInMeeting {
		// Check if user is the meeting host
		var meeting models.Meeting
		if err := c.db.Where("id = ?", meetingID).First(&meeting).Error; err != nil {
			utils.NotFoundResponse(ctx, "Meeting not found")
			return
		}
		
		if meeting.HostID != userUUID {
			utils.ForbiddenResponse(ctx, "You don't have access to this meeting")
			return
		}
	}

	// Convert participants to response format
	participantResponses := make([]WebSocketParticipantResponse, len(participants))
	for i, participant := range participants {
		participantResponses[i] = WebSocketParticipantResponse{
			ID:             participant.ID,
			Name:           participant.Name,
			IsAuthenticated: participant.IsAuth,
			UserID:         participant.UserID,
			PublicUserID:   participant.PublicUserID,
		}
	}

	utils.SuccessResponse(ctx, http.StatusOK, WebSocketParticipantsResponse{
		MeetingID:    meetingIDStr,
		Participants: participantResponses,
		Count:        len(participants),
	}, "Participants retrieved successfully")
}

// GetParticipantCount returns the number of active participants in a meeting
// @Summary Get participant count
// @Description Get the number of active WebSocket participants in a meeting
// @Tags websocket
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Router /api/v1/ws/meetings/{id}/participants/count [get]
func (c *WebSocketController) GetParticipantCount(ctx *gin.Context) {
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

	count := c.websocketService.GetParticipantCount(meetingIDStr)
	isActive := c.websocketService.IsMeetingActive(meetingIDStr)

	utils.SuccessResponse(ctx, http.StatusOK, ParticipantCountResponse{
		MeetingID: meetingIDStr,
		Count:     count,
		IsActive:  isActive,
	}, "Participant count retrieved successfully")
}

// SendMessageToMeeting sends a message to all participants in a meeting
// @Summary Send message to meeting
// @Description Send a message to all participants in a meeting (admin/host only)
// @Tags websocket
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "Meeting ID"
// @Param request body SendMessageRequest true "Message to send"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 403 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Router /api/v1/ws/meetings/{id}/send [post]
func (c *WebSocketController) SendMessageToMeeting(ctx *gin.Context) {
	meetingIDStr := ctx.Param("id")
	meetingID, err := uuid.Parse(meetingIDStr)
	if err != nil {
		utils.SendErrorResponse(ctx, http.StatusBadRequest, "INVALID_MEETING_ID", "Invalid meeting ID")
		return
	}

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
		utils.ForbiddenResponse(ctx, "Only meeting hosts can send messages to all participants")
		return
	}

	var req SendMessageRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.ValidationError(ctx, err)
		return
	}

	// Create and send message
	message := models.SignalingMessage{
		Type:      models.SignalingMessageType(req.Type),
		MeetingID: meetingIDStr,
		Data:      req.Data,
	}

	c.websocketService.SendMessageToMeeting(meetingIDStr, message)

	utils.SuccessResponse(ctx, http.StatusOK, nil, "Message sent successfully")
}

// Response types
type WebSocketParticipantResponse struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	IsAuthenticated bool       `json:"isAuthenticated"`
	UserID         *uuid.UUID `json:"userId,omitempty"`
	PublicUserID   *uuid.UUID `json:"publicUserId,omitempty"`
}

type WebSocketParticipantsResponse struct {
	MeetingID    string                        `json:"meetingId"`
	Participants []WebSocketParticipantResponse `json:"participants"`
	Count        int                           `json:"count"`
}

type ParticipantCountResponse struct {
	MeetingID string `json:"meetingId"`
	Count     int    `json:"count"`
	IsActive  bool   `json:"isActive"`
}

type SendMessageRequest struct {
	Type string      `json:"type" validate:"required"`
	Data interface{} `json:"data" validate:"required"`
}