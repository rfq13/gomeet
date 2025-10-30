package middleware

import (
	"bytes"
	"io"
	"time"

	"github.com/filosofine/gomeet-backend/internal/logger"
	"github.com/gin-gonic/gin"
)

// LoggingMiddleware provides comprehensive logging for API requests and responses
type LoggingMiddleware struct {
	logger *logger.Logger
}

// NewLoggingMiddleware creates a new logging middleware instance
func NewLoggingMiddleware(log *logger.Logger) *LoggingMiddleware {
	return &LoggingMiddleware{
		logger: log,
	}
}

// RequestResponseLogger logs detailed information about requests and responses
func (m *LoggingMiddleware) RequestResponseLogger() gin.HandlerFunc {
	return gin.LoggerWithConfig(gin.LoggerConfig{
		Formatter: func(param gin.LogFormatterParams) string {
			// We'll handle logging ourselves to have more control
			return ""
		},
		Output: io.Discard, // Disable default gin logging
	})
}

// LoggingInterceptor is a comprehensive middleware that logs request/response details
func (m *LoggingMiddleware) LoggingInterceptor() gin.HandlerFunc {
	return func(c *gin.Context) {
		startTime := time.Now()

		// Extract context for logging
		logCtx := m.logger.WithGinContext(c)

		// Read request body for logging (only for specific content types)
		var requestBody []byte
		if c.Request.Body != nil && m.shouldLogRequestBody(c) {
			requestBody, _ = io.ReadAll(c.Request.Body)
			c.Request.Body = io.NopCloser(bytes.NewBuffer(requestBody))
		}

		// Log incoming request
		m.logger.LogAPIRequest(logCtx, "API request started")

		// Log request details if in debug mode
		if m.logger.GetConfig().Level == logger.DebugLevel && len(requestBody) > 0 {
			m.logger.WithContext(logCtx).WithField("request_body", string(requestBody)).Debug("Request body")
		}

		// Process request
		c.Next()

		// Calculate duration
		duration := time.Since(startTime)

		// Update context with response information
		logCtx.StatusCode = c.Writer.Status()
		logCtx.Duration = duration

		// Determine log level based on status code
		logLevel := "info"
		if c.Writer.Status() >= 500 {
			logLevel = "error"
		} else if c.Writer.Status() >= 400 {
			logLevel = "warn"
		}

		// Log response
		message := "API request completed"
		if c.Writer.Status() >= 400 {
			message = "API request completed with errors"
		}

		switch logLevel {
		case "error":
			m.logger.WithContext(logCtx).Error(message)
		case "warn":
			m.logger.WithContext(logCtx).Warn(message)
		default:
			m.logger.LogAPIResponse(logCtx, message)
		}

		// Log performance metrics for slow requests
		if duration > 1*time.Second {
			m.logger.LogPerformance(logCtx, "slow_request", duration, map[string]interface{}{
				"slow_request_threshold": "1s",
				"endpoint":              c.Request.Method + " " + c.Request.URL.Path,
			})
		}

		// Log security events for suspicious activities
		m.logSecurityEvents(c, logCtx, requestBody)
	}
}

// shouldLogRequestBody determines if we should log the request body
func (m *LoggingMiddleware) shouldLogRequestBody(c *gin.Context) bool {
	contentType := c.GetHeader("Content-Type")
	
	// Don't log file uploads, large payloads, or sensitive data
	if contentType == "multipart/form-data" || 
	   contentType == "application/octet-stream" ||
	   c.Request.ContentLength > 1024*1024 { // 1MB limit
		return false
	}

	// Only log JSON and form data
	return contentType == "application/json" || 
		   contentType == "application/x-www-form-urlencoded"
}

// logSecurityEvents logs potential security issues
func (m *LoggingMiddleware) logSecurityEvents(c *gin.Context, logCtx logger.LogContext, requestBody []byte) {
	// Log suspicious user agents
	userAgent := c.GetHeader("User-Agent")
	suspiciousAgents := []string{
		"sqlmap", "nikto", "nmap", "masscan", "zap", "burp",
		"python-requests", "curl", "wget",
	}

	for _, agent := range suspiciousAgents {
		if userAgent != "" && contains(userAgent, agent) {
			m.logger.LogSecurity(logCtx, "suspicious_user_agent", map[string]interface{}{
				"user_agent": userAgent,
				"pattern":    agent,
			})
			break
		}
	}

	// Log potential SQL injection attempts
	if len(requestBody) > 0 {
		bodyStr := string(requestBody)
		sqlPatterns := []string{
			"' OR '1'='1", "' OR 1=1--", "UNION SELECT", "DROP TABLE",
			"INSERT INTO", "DELETE FROM", "UPDATE SET", "SELECT * FROM",
		}

		for _, pattern := range sqlPatterns {
			if contains(bodyStr, pattern) {
				m.logger.LogSecurity(logCtx, "potential_sql_injection", map[string]interface{}{
					"pattern": pattern,
					"body":    bodyStr[:min(len(bodyStr), 500)], // Log first 500 chars
				})
				break
			}
		}
	}

	// Log rate limit violations
	if c.Writer.Status() == 429 {
		m.logger.LogSecurity(logCtx, "rate_limit_exceeded", map[string]interface{}{
			"endpoint": c.Request.Method + " " + c.Request.URL.Path,
		})
	}

	// Log authentication failures
	if c.Writer.Status() == 401 {
		m.logger.LogSecurity(logCtx, "authentication_failure", map[string]interface{}{
			"endpoint": c.Request.Method + " " + c.Request.URL.Path,
		})
	}

	// Log authorization failures
	if c.Writer.Status() == 403 {
		m.logger.LogSecurity(logCtx, "authorization_failure", map[string]interface{}{
			"endpoint": c.Request.Method + " " + c.Request.URL.Path,
		})
	}
}

// contains checks if a string contains a substring (case-insensitive)
func contains(s, substr string) bool {
	return len(s) >= len(substr) && 
		   (s == substr || 
		    len(s) > len(substr) && 
		    (s[:len(substr)] == substr || 
		     s[len(s)-len(substr):] == substr ||
		     containsSubstring(s, substr)))
}

func containsSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ErrorLogger logs errors with context
func (m *LoggingMiddleware) ErrorLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		// Log any errors that occurred during request processing
		if len(c.Errors) > 0 {
			logCtx := m.logger.WithGinContext(c)
			logCtx.StatusCode = c.Writer.Status()

			for _, err := range c.Errors {
				m.logger.LogError(logCtx, err.Err, "Request processing error")
			}
		}
	}
}

// RecoveryLogger logs panics and recovers from them
func (m *LoggingMiddleware) RecoveryLogger() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, recovered interface{}) {
		logCtx := m.logger.WithGinContext(c)
		
		var err error
		switch x := recovered.(type) {
		case string:
			err = &gin.Error{Err: &recoveredError{msg: x}, Type: gin.ErrorTypePublic}
		case error:
			err = x
		default:
			err = &gin.Error{Err: &recoveredError{msg: "unknown panic"}, Type: gin.ErrorTypePublic}
		}

		m.logger.LogPanic(logCtx, err, "Panic recovered")

		c.JSON(500, gin.H{
			"success": false,
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": "An internal server error occurred",
			},
		})
	})
}

// recoveredError is a simple error type for panics
type recoveredError struct {
	msg string
}

func (e *recoveredError) Error() string {
	return e.msg
}