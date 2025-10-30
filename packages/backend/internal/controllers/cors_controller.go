package controllers

import (
	"math"
	"net/http"
	"strconv"

	"github.com/filosofine/gomeet-backend/internal/middleware"
	"github.com/filosofine/gomeet-backend/internal/utils"
	"github.com/gin-gonic/gin"
)

// CORSController handles CORS-related endpoints
type CORSController struct {
	corsMiddleware *middleware.CORSMiddleware
}

// NewCORSController creates a new CORS controller
func NewCORSController(corsMiddleware *middleware.CORSMiddleware) *CORSController {
	return &CORSController{
		corsMiddleware: corsMiddleware,
	}
}

// GetMetrics returns CORS metrics
// @Summary Get CORS metrics
// @Description Returns current CORS metrics including request counts and statistics
// @Tags CORS
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Router /api/v1/cors/metrics [get]
func (ctrl *CORSController) GetMetrics(c *gin.Context) {
	metrics := ctrl.corsMiddleware.GetMetrics()
	
	// Calculate additional statistics
	totalRequests := metrics.TotalRequests
	allowedRate := float64(0)
	blockedRate := float64(0)
	
	if totalRequests > 0 {
		allowedRate = float64(metrics.AllowedRequests) / float64(totalRequests) * 100
		blockedRate = float64(metrics.BlockedRequests) / float64(totalRequests) * 100
	}
	
	response := map[string]interface{}{
		"metrics": map[string]interface{}{
			"total_requests":     metrics.TotalRequests,
			"allowed_requests":   metrics.AllowedRequests,
			"blocked_requests":   metrics.BlockedRequests,
			"preflight_requests": metrics.PreflightRequests,
			"cache_hits":         metrics.CacheHits,
			"cache_misses":       metrics.CacheMisses,
		},
		"statistics": map[string]interface{}{
			"allowed_rate_percent": roundToTwoDecimal(allowedRate),
			"blocked_rate_percent": roundToTwoDecimal(blockedRate),
		},
		"performance": map[string]interface{}{
			"cache_hit_rate_percent": roundToTwoDecimal(float64(metrics.CacheHits) / float64(metrics.CacheHits+metrics.CacheMisses) * 100),
		},
	}
	
	c.JSON(http.StatusOK, response)
}

// ResetMetrics resets CORS metrics
// @Summary Reset CORS metrics
// @Description Resets all CORS metrics to zero
// @Tags CORS
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Router /api/v1/cors/metrics/reset [post]
func (ctrl *CORSController) ResetMetrics(c *gin.Context) {
	ctrl.corsMiddleware.ResetMetrics()
	utils.SuccessResponse(c, http.StatusOK, nil, "CORS metrics reset successfully")
}

// RefreshOrigins refreshes the allowed origins configuration
// @Summary Refresh CORS origins
// @Description Refreshes the allowed origins configuration from environment variables
// @Tags CORS
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Router /api/v1/cors/refresh [post]
func (ctrl *CORSController) RefreshOrigins(c *gin.Context) {
	ctrl.corsMiddleware.RefreshOrigins()
	utils.SuccessResponse(c, http.StatusOK, nil, "CORS origins refreshed successfully")
}

// GetConfig returns current CORS configuration
// @Summary Get CORS configuration
// @Description Returns the current CORS configuration (excluding sensitive data)
// @Tags CORS
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Router /api/v1/cors/config [get]
func (ctrl *CORSController) GetConfig(c *gin.Context) {
	config := ctrl.corsMiddleware.GetConfig()
	allowedOrigins := ctrl.corsMiddleware.GetAllowedOrigins()
	
	configData := map[string]interface{}{
		"max_age":           config.MaxAge,
		"debug_mode":        config.DebugMode,
		"enable_metrics":    config.EnableMetrics,
		"allowed_origins":   allowedOrigins,
		"development_origins": config.DevelopmentOrigins,
		"production_origins":  config.ProductionOrigins,
		"legacy_origins":    config.AllowedOrigins,
	}
	
	utils.SuccessResponse(c, http.StatusOK, configData, "CORS configuration retrieved")
}

// GetViolations returns recent CORS violations (placeholder implementation)
// @Summary Get CORS violations
// @Description Returns recent CORS violations for monitoring
// @Tags CORS
// @Produce json
// @Param limit query int false "Limit number of violations to return"
// @Success 200 {object} map[string]interface{}
// @Router /api/v1/cors/violations [get]
func (ctrl *CORSController) GetViolations(c *gin.Context) {
	limitStr := c.DefaultQuery("limit", "100")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 {
		limit = 100
	}
	
	// Placeholder implementation - in real scenario, this would fetch from a log store
	violations := []map[string]interface{}{
		{
			"timestamp": "2024-01-01T00:00:00Z",
			"origin":    "https://malicious-site.com",
			"method":    "POST",
			"path":      "/api/v1/auth/login",
			"ip":        "192.168.1.100",
		},
	}
	
	response := map[string]interface{}{
		"violations": violations,
		"total":      len(violations),
		"limit":      limit,
	}
	
	utils.SuccessResponse(c, http.StatusOK, response, "CORS violations retrieved")
}

// roundToTwoDecimal rounds a float64 to 2 decimal places
func roundToTwoDecimal(num float64) float64 {
	return math.Round(num*100) / 100
}