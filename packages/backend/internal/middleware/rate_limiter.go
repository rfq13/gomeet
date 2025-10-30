package middleware

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"

	"github.com/filosofine/gomeet-backend/internal/services"
)

type RateLimitType string

const (
	RateLimitGeneral        RateLimitType = "general"
	RateLimitAuth          RateLimitType = "auth"
	RateLimitAuthenticated RateLimitType = "authenticated"
)

type RateLimiterMiddleware struct {
	rateLimiterService *services.RateLimiterService
	logger             *logrus.Logger
}

// NewRateLimiterMiddleware creates a new rate limiter middleware
func NewRateLimiterMiddleware(rateLimiterService *services.RateLimiterService) *RateLimiterMiddleware {
	logger := logrus.New()
	logger.SetLevel(logrus.InfoLevel)
	
	return &RateLimiterMiddleware{
		rateLimiterService: rateLimiterService,
		logger:             logger,
	}
}

// RateLimit creates a rate limiting middleware function
func (m *RateLimiterMiddleware) RateLimit(limitType RateLimitType) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip rate limiting if service is disabled
		if !m.rateLimiterService.IsEnabled() {
			c.Next()
			return
		}

		var result *services.RateLimitResult
		var err error
		var identifier string

		// Get client IP
		clientIP := c.ClientIP()
		
		switch limitType {
		case RateLimitAuth:
			// For auth endpoints, use IP-based limiting with stricter limits
			identifier = clientIP
			result, err = m.rateLimiterService.CheckAuthRateLimit(clientIP)
			
		case RateLimitAuthenticated:
			// For authenticated endpoints, try to get user ID first, fallback to IP
			userID := m.getUserID(c)
			if userID != "" {
				identifier = userID
				result, err = m.rateLimiterService.CheckAuthenticatedRateLimit(userID)
			} else {
				// Fallback to general rate limiting if no user ID
				identifier = clientIP
				result, err = m.rateLimiterService.CheckGeneralRateLimit(clientIP)
			}
			
		case RateLimitGeneral:
			fallthrough
		default:
			// For general endpoints, use IP-based limiting
			identifier = clientIP
			result, err = m.rateLimiterService.CheckGeneralRateLimit(clientIP)
		}

		// Handle Redis errors - fail open
		if err != nil {
			m.logger.WithFields(logrus.Fields{
				"error":      err,
				"identifier": identifier,
				"type":       limitType,
				"ip":         clientIP,
				"path":       c.Request.URL.Path,
				"method":     c.Request.Method,
			}).Warn("Rate limiting error, allowing request")
			c.Next()
			return
		}

		// Set rate limit headers
		c.Header("X-RateLimit-Limit", fmt.Sprintf("%d", result.TotalLimit))
		c.Header("X-RateLimit-Remaining", fmt.Sprintf("%d", result.Remaining))
		c.Header("X-RateLimit-Reset", fmt.Sprintf("%d", result.ResetTime.Unix()))

		// Log rate limit check
		m.logger.WithFields(logrus.Fields{
			"identifier": identifier,
			"type":       limitType,
			"allowed":    result.Allowed,
			"remaining":  result.Remaining,
			"limit":      result.TotalLimit,
			"ip":         clientIP,
			"path":       c.Request.URL.Path,
			"method":     c.Request.Method,
			"user_agent": c.GetHeader("User-Agent"),
		}).Debug("Rate limit check")

		// Check if request is allowed
		if !result.Allowed {
			m.logger.WithFields(logrus.Fields{
				"identifier": identifier,
				"type":       limitType,
				"limit":      result.TotalLimit,
				"window":     "1m",
				"ip":         clientIP,
				"path":       c.Request.URL.Path,
				"method":     c.Request.Method,
				"user_agent": c.GetHeader("User-Agent"),
			}).Warn("Rate limit exceeded")

			// Return rate limit exceeded error
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded",
				"message": gin.H{
					"en": "Too many requests. Please try again later.",
					"id": "Terlalu banyak permintaan. Silakan coba lagi nanti.",
				},
				"retry_after": int(result.ResetTime.Sub(time.Now()).Seconds()),
				"limit":       result.TotalLimit,
				"window":      "1m",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// getUserID extracts user ID from the context (set by auth middleware)
func (m *RateLimiterMiddleware) getUserID(c *gin.Context) string {
	// Try to get user ID from context (set by auth middleware)
	if userID, exists := c.Get("user_id"); exists {
		if id, ok := userID.(string); ok {
			return id
		}
	}
	
	// Try to get from JWT token in Authorization header
	authHeader := c.GetHeader("Authorization")
	if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
		// Note: In a real implementation, you might want to decode the JWT here
		// For now, we'll rely on the auth middleware to set the user_id
		// This avoids duplicate JWT parsing
	}
	
	return ""
}

// GetClientIP extracts the real client IP from request headers
func GetClientIP(c *gin.Context) string {
	// Check X-Forwarded-For header first (for reverse proxies)
	if xff := c.GetHeader("X-Forwarded-For"); xff != "" {
		// X-Forwarded-For can contain multiple IPs, take the first one
		ips := strings.Split(xff, ",")
		if len(ips) > 0 {
			return strings.TrimSpace(ips[0])
		}
	}
	
	// Check X-Real-IP header
	if xri := c.GetHeader("X-Real-IP"); xri != "" {
		return xri
	}
	
	// Fall back to RemoteAddr
	return c.ClientIP()
}