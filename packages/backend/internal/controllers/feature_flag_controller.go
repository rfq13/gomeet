package controllers

import (
	"net/http"

	"github.com/filosofine/gomeet-backend/internal/services"
	"github.com/filosofine/gomeet-backend/internal/utils"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

type FeatureFlagController struct {
	featureFlagService *services.FeatureFlagService
	logger             *logrus.Logger
}

type SetFlagRequest struct {
	FlagName string `json:"flag_name" binding:"required"`
	Enabled  bool   `json:"enabled"`
}

type MeetingFlagRequest struct {
	MeetingID string `json:"meeting_id" binding:"required"`
	Enabled   bool   `json:"enabled"`
}

func NewFeatureFlagController(featureFlagService *services.FeatureFlagService) *FeatureFlagController {
	logger := logrus.New()
	logger.SetLevel(logrus.InfoLevel)

	return &FeatureFlagController{
		featureFlagService: featureFlagService,
		logger:             logger,
	}
}

// GetFeatureConfig returns the current feature configuration
func (c *FeatureFlagController) GetFeatureConfig(ctx *gin.Context) {
	config, err := c.featureFlagService.GetFeatureConfig()
	if err != nil {
		c.logger.WithError(err).Error("Failed to get feature config")
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, utils.INTERNAL_ERROR, "Failed to get feature configuration")
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, config, "Feature configuration retrieved successfully")
}

// GetAllFlags returns all feature flags with their current status
func (c *FeatureFlagController) GetAllFlags(ctx *gin.Context) {
	flags, err := c.featureFlagService.GetAllFlags()
	if err != nil {
		c.logger.WithError(err).Error("Failed to get all flags")
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, utils.INTERNAL_ERROR, "Failed to get feature flags")
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, flags, "Feature flags retrieved successfully")
}

// SetFlag enables or disables a feature flag
func (c *FeatureFlagController) SetFlag(ctx *gin.Context) {
	var req SetFlagRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		c.logger.WithError(err).Error("Invalid request body")
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.VALIDATION_ERROR, "Invalid request body")
		return
	}

	if err := c.featureFlagService.SetFlag(req.FlagName, req.Enabled); err != nil {
		c.logger.WithError(err).WithField("flag", req.FlagName).Error("Failed to set feature flag")
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, utils.INTERNAL_ERROR, "Failed to set feature flag")
		return
	}

	c.logger.WithFields(logrus.Fields{
		"flag":    req.FlagName,
		"enabled": req.Enabled,
	}).Info("Feature flag updated")

	response := gin.H{
		"flag_name": req.FlagName,
		"enabled":   req.Enabled,
	}
	utils.SuccessResponse(ctx, http.StatusOK, response, "Feature flag updated successfully")
}

// IsFlagEnabled checks if a feature flag is enabled
func (c *FeatureFlagController) IsFlagEnabled(ctx *gin.Context) {
	flagName := ctx.Param("flag")
	if flagName == "" {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.VALIDATION_ERROR, "Flag name is required")
		return
	}

	enabled, err := c.featureFlagService.IsFlagEnabled(flagName)
	if err != nil {
		c.logger.WithError(err).WithField("flag", flagName).Error("Failed to check feature flag")
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, utils.INTERNAL_ERROR, "Failed to check feature flag")
		return
	}

	response := gin.H{
		"flag_name": flagName,
		"enabled":   enabled,
	}
	utils.SuccessResponse(ctx, http.StatusOK, response, "Feature flag status retrieved successfully")
}

// EnableLiveKitForMeeting enables LiveKit SFU for a specific meeting
func (c *FeatureFlagController) EnableLiveKitForMeeting(ctx *gin.Context) {
	var req MeetingFlagRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		c.logger.WithError(err).Error("Invalid request body")
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.VALIDATION_ERROR, "Invalid request body")
		return
	}

	if err := c.featureFlagService.EnableLiveKitForMeeting(req.MeetingID); err != nil {
		c.logger.WithError(err).WithField("meeting_id", req.MeetingID).Error("Failed to enable LiveKit for meeting")
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, utils.INTERNAL_ERROR, "Failed to enable LiveKit for meeting")
		return
	}

	c.logger.WithField("meeting_id", req.MeetingID).Info("LiveKit enabled for meeting")

	response := gin.H{
		"meeting_id": req.MeetingID,
		"enabled":    true,
	}
	utils.SuccessResponse(ctx, http.StatusOK, response, "LiveKit enabled for meeting successfully")
}

// DisableLiveKitForMeeting disables LiveKit SFU for a specific meeting
func (c *FeatureFlagController) DisableLiveKitForMeeting(ctx *gin.Context) {
	meetingID := ctx.Param("meetingId")
	if meetingID == "" {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.VALIDATION_ERROR, "Meeting ID is required")
		return
	}

	if err := c.featureFlagService.DisableLiveKitForMeeting(meetingID); err != nil {
		c.logger.WithError(err).WithField("meeting_id", meetingID).Error("Failed to disable LiveKit for meeting")
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, utils.INTERNAL_ERROR, "Failed to disable LiveKit for meeting")
		return
	}

	c.logger.WithField("meeting_id", meetingID).Info("LiveKit disabled for meeting")

	response := gin.H{
		"meeting_id": meetingID,
		"enabled":    false,
	}
	utils.SuccessResponse(ctx, http.StatusOK, response, "LiveKit disabled for meeting successfully")
}

// ShouldUseLiveKitForMeeting checks if LiveKit should be used for a specific meeting
func (c *FeatureFlagController) ShouldUseLiveKitForMeeting(ctx *gin.Context) {
	meetingID := ctx.Param("meetingId")
	if meetingID == "" {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.VALIDATION_ERROR, "Meeting ID is required")
		return
	}

	shouldUse, err := c.featureFlagService.ShouldUseLiveKitForMeeting(meetingID)
	if err != nil {
		c.logger.WithError(err).WithField("meeting_id", meetingID).Error("Failed to check LiveKit setting for meeting")
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, utils.INTERNAL_ERROR, "Failed to check LiveKit setting for meeting")
		return
	}

	response := gin.H{
		"meeting_id":   meetingID,
		"should_use":   shouldUse,
		"architecture": c.getArchitectureString(shouldUse),
	}
	utils.SuccessResponse(ctx, http.StatusOK, response, "LiveKit setting for meeting retrieved successfully")
}

// GetMigrationStats returns statistics about the migration progress
func (c *FeatureFlagController) GetMigrationStats(ctx *gin.Context) {
	stats, err := c.featureFlagService.GetMigrationStats()
	if err != nil {
		c.logger.WithError(err).Error("Failed to get migration stats")
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, utils.INTERNAL_ERROR, "Failed to get migration statistics")
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, stats, "Migration statistics retrieved successfully")
}

// CleanupExpiredFlags cleans up expired feature flags and meeting-specific settings
func (c *FeatureFlagController) CleanupExpiredFlags(ctx *gin.Context) {
	if err := c.featureFlagService.CleanupExpiredFlags(); err != nil {
		c.logger.WithError(err).Error("Failed to cleanup expired flags")
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, utils.INTERNAL_ERROR, "Failed to cleanup expired flags")
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, gin.H{}, "Expired flags cleaned up successfully")
}

// GetMigrationPhase returns the current migration phase
func (c *FeatureFlagController) GetMigrationPhase(ctx *gin.Context) {
	config, err := c.featureFlagService.GetFeatureConfig()
	if err != nil {
		c.logger.WithError(err).Error("Failed to get feature config for migration phase")
		utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError, utils.INTERNAL_ERROR, "Failed to get migration phase")
		return
	}

	phase := c.getMigrationPhase(config)
	recommendations := c.getMigrationRecommendations(phase)

	response := gin.H{
		"phase":          phase,
		"description":    c.getPhaseDescription(phase),
		"recommendations": recommendations,
		"config":         config,
	}
	utils.SuccessResponse(ctx, http.StatusOK, response, "Migration phase retrieved successfully")
}

// BatchSetFlags enables or disables multiple feature flags at once
func (c *FeatureFlagController) BatchSetFlags(ctx *gin.Context) {
	var requests []SetFlagRequest
	if err := ctx.ShouldBindJSON(&requests); err != nil {
		c.logger.WithError(err).Error("Invalid request body")
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.VALIDATION_ERROR, "Invalid request body")
		return
	}

	results := make([]gin.H, 0, len(requests))
	errors := make([]gin.H, 0)

	for _, req := range requests {
		if err := c.featureFlagService.SetFlag(req.FlagName, req.Enabled); err != nil {
			c.logger.WithError(err).WithField("flag", req.FlagName).Error("Failed to set feature flag in batch")
			errors = append(errors, gin.H{
				"flag_name": req.FlagName,
				"error":     err.Error(),
			})
		} else {
			results = append(results, gin.H{
				"flag_name": req.FlagName,
				"enabled":   req.Enabled,
			})
		}
	}

	response := gin.H{
		"success_count": len(results),
		"error_count":   len(errors),
		"results":       results,
	}

	if len(errors) > 0 {
		response["errors"] = errors
		c.logger.WithFields(logrus.Fields{
			"success_count": len(results),
			"error_count":   len(errors),
		}).Warn("Batch flag update completed with errors")
	} else {
		c.logger.WithField("count", len(results)).Info("Batch flag update completed successfully")
	}

	utils.SuccessResponse(ctx, http.StatusOK, response, "Batch flag update completed")
}

// Helper functions

func (c *FeatureFlagController) getArchitectureString(shouldUseLiveKit bool) string {
	if shouldUseLiveKit {
		return "SFU (LiveKit)"
	}
	return "Mesh (WebRTC)"
}

func (c *FeatureFlagController) getMigrationPhase(config *services.FeatureFlagConfig) string {
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

func (c *FeatureFlagController) getPhaseDescription(phase string) string {
	descriptions := map[string]string{
		"mesh_only":        "Using traditional mesh WebRTC architecture only",
		"parallel_testing": "Running both mesh WebRTC and SFU (LiveKit) in parallel for testing",
		"sfu_only":         "Using SFU (LiveKit) architecture only",
		"unknown":          "Unknown migration phase",
	}

	if desc, exists := descriptions[phase]; exists {
		return desc
	}
	return descriptions["unknown"]
}

func (c *FeatureFlagController) getMigrationRecommendations(phase string) []string {
	recommendations := map[string][]string{
		"mesh_only": {
			"Enable LiveKit SFU for testing by setting 'use_livekit_sfu' to true",
			"Start with a small percentage of meetings using LiveKit",
			"Monitor performance and resource usage",
		},
		"parallel_testing": {
			"Gradually increase the percentage of meetings using LiveKit",
			"Compare performance metrics between mesh and SFU",
			"Collect user feedback on video quality and reliability",
		},
		"sfu_only": {
			"Monitor system performance and scalability",
			"Ensure all meetings are working correctly with SFU",
			"Consider enabling mesh as fallback if needed",
		},
		"unknown": {
			"Check feature flag configuration",
			"Ensure both 'use_livekit_sfu' and 'use_webrtc_mesh' flags are properly set",
		},
	}

	if recs, exists := recommendations[phase]; exists {
		return recs
	}
	return recommendations["unknown"]
}