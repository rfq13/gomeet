package controllers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"

	"github.com/filosofine/gomeet-backend/internal/config"
	"github.com/filosofine/gomeet-backend/internal/services"
	"github.com/filosofine/gomeet-backend/internal/utils"
)

type TurnController struct {
	turnService *services.TurnService
	logger      *logrus.Logger
	config      *config.Config
	validator   *validator.Validate
}

func NewTurnController(turnService *services.TurnService, cfg *config.Config) *TurnController {
	logger := logrus.New()
	logger.SetLevel(logrus.InfoLevel)

	return &TurnController{
		turnService: turnService,
		logger:      logger,
		config:      cfg,
		validator:   validator.New(),
	}
}

// GetTurnCredentials generates TURN credentials for WebRTC NAT traversal
// @Summary Get TURN credentials
// @Description Generate TURN credentials for WebRTC NAT traversal
// @Tags turn
// @Produce json
// @Security BearerAuth
// @Param request body TurnCredentialsRequest true "TURN credentials request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Router /api/v1/turn/credentials [post]
func (c *TurnController) GetTurnCredentials(ctx *gin.Context) {
	var req TurnCredentialsRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	// Check if TURN is enabled
	if !c.config.TURN.Enabled {
		utils.HandleSendErrorResponse(ctx, http.StatusServiceUnavailable, "TURN_DISABLED", "TURN server is disabled")
		return
	}

	// Get user info
	userID, exists := utils.GetUserID(ctx)
	var userUUID *uuid.UUID
	
	if exists {
		parsedUUID, err := uuid.Parse(userID)
		if err != nil {
			utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_USER_ID, "Invalid user ID")
			return
		}
		userUUID = &parsedUUID
	}

	// Parse meeting ID if provided
	var meetingUUID *uuid.UUID
	if req.MeetingID != "" {
		parsedUUID, err := uuid.Parse(req.MeetingID)
		if err != nil {
			utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_MEETING_ID, "Invalid meeting ID")
			return
		}
		meetingUUID = &parsedUUID
	}

	// Set TTL (default to 24 hours)
	ttl := 24 * time.Hour
	if req.TTL > 0 {
		ttl = time.Duration(req.TTL) * time.Second
	}

	// Generate TURN credentials
	credentials, err := c.turnService.GenerateCredentials(ctx.Request.Context(), userUUID, meetingUUID, ttl)
	if err != nil {
		c.logger.WithError(err).Error("Failed to generate TURN credentials")
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, "TURN_CREDENTIALS_FAILED", "Failed to generate TURN credentials")
		return
	}

	c.logger.WithFields(logrus.Fields{
		"username": credentials.Username,
		"user_id":  userUUID,
		"meeting_id": meetingUUID,
		"ttl":      ttl,
	}).Info("TURN credentials generated successfully")

	utils.SuccessResponse(ctx, http.StatusOK, credentials, "TURN credentials generated successfully")
}

// GetICEServers returns optimized ICE server configuration
// @Summary Get ICE servers
// @Description Get optimized ICE server configuration including STUN and TURN servers
// @Tags turn
// @Produce json
// @Security BearerAuth
// @Param meetingId query string false "Meeting ID for credential generation"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Router /api/v1/turn/ice-servers [get]
func (c *TurnController) GetICEServers(ctx *gin.Context) {
	// Get user info
	userID, exists := utils.GetUserID(ctx)
	var userUUID *uuid.UUID
	
	if exists {
		parsedUUID, err := uuid.Parse(userID)
		if err != nil {
			utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_USER_ID, "Invalid user ID")
			return
		}
		userUUID = &parsedUUID
	}

	// Parse meeting ID if provided
	meetingIDStr := ctx.Query("meetingId")
	var meetingUUID *uuid.UUID
	if meetingIDStr != "" {
		parsedUUID, err := uuid.Parse(meetingIDStr)
		if err != nil {
			utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.INVALID_MEETING_ID, "Invalid meeting ID")
			return
		}
		meetingUUID = &parsedUUID
	}

	// Get ICE servers with TURN credentials
	iceServers, err := c.turnService.GetICEServers(ctx.Request.Context(), userUUID, meetingUUID)
	if err != nil {
		c.logger.WithError(err).Error("Failed to get ICE servers")
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, "ICE_SERVERS_FAILED", "Failed to get ICE servers")
		return
	}

	// Add configuration metadata
	response := map[string]interface{}{
		"iceServers": iceServers,
		"configuration": map[string]interface{}{
			"iceCandidatePoolSize": 10,
			"iceTransportPolicy":   "all",
			"bundlePolicy":         "max-bundle",
			"rtcpMuxPolicy":        "require",
		},
		"turnConfig": map[string]interface{}{
			"enabled":        c.config.TURN.Enabled,
			"server":         c.config.TURN.Server,
			"port":           c.config.TURN.Port,
			"maxBandwidth":   c.config.TURN.MaxBandwidth,
			"totalBandwidth": c.config.TURN.TotalBandwidth,
		},
	}

	utils.SuccessResponse(ctx, http.StatusOK, response, "ICE servers retrieved successfully")
}

// RevokeTurnCredentials revokes TURN credentials
// @Summary Revoke TURN credentials
// @Description Revoke TURN credentials for a user
// @Tags turn
// @Produce json
// @Security BearerAuth
// @Param request body RevokeTurnCredentialsRequest true "Revoke TURN credentials request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Router /api/v1/turn/revoke [post]
func (c *TurnController) RevokeTurnCredentials(ctx *gin.Context) {
	var req RevokeTurnCredentialsRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	// Revoke credentials
	err := c.turnService.RevokeCredentials(ctx.Request.Context(), req.Username)
	if err != nil {
		c.logger.WithError(err).WithField("username", req.Username).Error("Failed to revoke TURN credentials")
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, "TURN_REVOKE_FAILED", "Failed to revoke TURN credentials")
		return
	}

	c.logger.WithField("username", req.Username).Info("TURN credentials revoked successfully")

	utils.SuccessResponse(ctx, http.StatusOK, nil, "TURN credentials revoked successfully")
}

// GetTurnStats returns TURN server statistics
// @Summary Get TURN statistics
// @Description Get TURN server usage statistics and metrics
// @Tags turn
// @Produce json
// @Security BearerAuth
// @Success 200 {object} utils.APIResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 403 {object} utils.ErrorResponse
// @Router /api/v1/turn/stats [get]
func (c *TurnController) GetTurnStats(ctx *gin.Context) {
	// Check if user is admin (implement admin check if needed)
	// For now, allow any authenticated user to view stats

	stats, err := c.turnService.GetStats(ctx.Request.Context())
	if err != nil {
		c.logger.WithError(err).Error("Failed to get TURN stats")
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, "TURN_STATS_FAILED", "Failed to get TURN statistics")
		return
	}

	// Add additional metadata
	stats["turnConfig"] = map[string]interface{}{
		"enabled":        c.config.TURN.Enabled,
		"server":         c.config.TURN.Server,
		"port":           c.config.TURN.Port,
		"tlsPort":        c.config.TURN.TLSPort,
		"maxBandwidth":   c.config.TURN.MaxBandwidth,
		"totalBandwidth": c.config.TURN.TotalBandwidth,
		"altServers":     c.config.TURN.AltServers,
	}

	utils.SuccessResponse(ctx, http.StatusOK, stats, "TURN statistics retrieved successfully")
}

// Request types
type TurnCredentialsRequest struct {
	MeetingID string `json:"meetingId,omitempty"`
	TTL       int64  `json:"ttl,omitempty"` // TTL in seconds
}

type RevokeTurnCredentialsRequest struct {
	Username string `json:"username" validate:"required"`
}