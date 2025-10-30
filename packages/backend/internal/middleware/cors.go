package middleware

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/filosofine/gomeet-backend/internal/config"
	"github.com/gin-gonic/gin"
)

// CORSMetrics tracks CORS-related metrics
type CORSMetrics struct {
	TotalRequests    int64
	AllowedRequests  int64
	BlockedRequests  int64
	PreflightRequests int64
	CacheHits        int64
	CacheMisses      int64
}

// CORSMiddleware handles Cross-Origin Resource Sharing with performance optimizations
type CORSMiddleware struct {
	config           config.CORSConfig
	allowedOrigins   map[string]bool
	allowedOriginsMu sync.RWMutex
	metrics          CORSMetrics
	metricsMu        sync.RWMutex
	logger           CORSLogger
}

// CORSLogger interface for structured logging
type CORSLogger interface {
	LogAllowedRequest(origin, method, path string)
	LogBlockedRequest(origin, method, path string)
	LogPreflightRequest(origin, method, path string)
	LogViolation(origin, method, path string)
}

// DefaultCORSLogger implements basic logging
type DefaultCORSLogger struct {
	debugMode bool
}

func NewDefaultCORSLogger(debugMode bool) *DefaultCORSLogger {
	return &DefaultCORSLogger{debugMode: debugMode}
}

func (l *DefaultCORSLogger) LogAllowedRequest(origin, method, path string) {
	if l.debugMode {
		gin.DefaultWriter.Write([]byte(fmt.Sprintf("✅ CORS Allowed - Origin: %s, Method: %s, Path: %s\n", origin, method, path)))
	}
}

func (l *DefaultCORSLogger) LogBlockedRequest(origin, method, path string) {
	if l.debugMode {
		gin.DefaultWriter.Write([]byte(fmt.Sprintf("❌ CORS Blocked - Origin: %s, Method: %s, Path: %s\n", origin, method, path)))
	}
}

func (l *DefaultCORSLogger) LogPreflightRequest(origin, method, path string) {
	if l.debugMode {
		gin.DefaultWriter.Write([]byte(fmt.Sprintf("🔧 CORS Preflight - Origin: %s, Method: %s, Path: %s\n", origin, method, path)))
	}
}

func (l *DefaultCORSLogger) LogViolation(origin, method, path string) {
	gin.DefaultWriter.Write([]byte(fmt.Sprintf("🚨 CORS Violation - Origin: %s, Method: %s, Path: %s\n", origin, method, path)))
}

// NewCORSMiddleware creates a new optimized CORS middleware
func NewCORSMiddleware(cfg config.CORSConfig) *CORSMiddleware {
	cors := &CORSMiddleware{
		config:         cfg,
		allowedOrigins: make(map[string]bool),
		logger:         NewDefaultCORSLogger(cfg.DebugMode),
	}
	
	// Initialize allowed origins map
	cors.updateAllowedOrigins()
	
	return cors
}

// updateAllowedOrigins refreshes the allowed origins map based on environment
func (c *CORSMiddleware) updateAllowedOrigins() {
	c.allowedOriginsMu.Lock()
	defer c.allowedOriginsMu.Unlock()
	
	// Clear existing map
	c.allowedOrigins = make(map[string]bool)
	
	// Determine which origins to use based on environment
	var origins []string
	if len(c.config.AllowedOrigins) > 0 {
		// Legacy support for ALLOWED_ORIGINS
		origins = c.config.AllowedOrigins
	} else {
		// Use environment-based origins
		if gin.Mode() == gin.ReleaseMode {
			origins = c.config.ProductionOrigins
		} else {
			origins = c.config.DevelopmentOrigins
		}
	}
	
	// Populate map for O(1) lookup
	for _, origin := range origins {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			c.allowedOrigins[origin] = true
		}
	}
}

// isOriginAllowed checks if origin is allowed using O(1) map lookup
func (c *CORSMiddleware) isOriginAllowed(origin string) bool {
	if origin == "" {
		return false
	}
	
	c.allowedOriginsMu.RLock()
	defer c.allowedOriginsMu.RUnlock()
	
	// Check exact match first
	if c.allowedOrigins[origin] {
		return true
	}
	
	// Check for wildcard patterns
	for allowedOrigin := range c.allowedOrigins {
		if allowedOrigin == "*" {
			return true
		}
		
		// Support subdomain wildcards like *.example.com
		if strings.HasPrefix(allowedOrigin, "*.") {
			domain := allowedOrigin[2:]
			if strings.HasSuffix(origin, domain) {
				// Check that the subdomain part is valid
				parts := strings.Split(origin, ".")
				if len(parts) >= 2 {
					return true
				}
			}
		}
	}
	
	return false
}

// updateMetrics updates CORS metrics thread-safely
func (c *CORSMiddleware) updateMetrics(requestType string) {
	if !c.config.EnableMetrics {
		return
	}
	
	c.metricsMu.Lock()
	defer c.metricsMu.Unlock()
	
	c.metrics.TotalRequests++
	switch requestType {
	case "allowed":
		c.metrics.AllowedRequests++
	case "blocked":
		c.metrics.BlockedRequests++
	case "preflight":
		c.metrics.PreflightRequests++
	case "cache_hit":
		c.metrics.CacheHits++
	case "cache_miss":
		c.metrics.CacheMisses++
	}
}

// GetMetrics returns current CORS metrics
func (c *CORSMiddleware) GetMetrics() CORSMetrics {
	c.metricsMu.RLock()
	defer c.metricsMu.RUnlock()
	return c.metrics
}

// GetConfig returns current CORS configuration
func (c *CORSMiddleware) GetConfig() config.CORSConfig {
	return c.config
}

// ResetMetrics resets all CORS metrics
func (c *CORSMiddleware) ResetMetrics() {
	c.metricsMu.Lock()
	defer c.metricsMu.Unlock()
	c.metrics = CORSMetrics{}
}

// GetAllowedOrigins returns current allowed origins
func (c *CORSMiddleware) GetAllowedOrigins() []string {
	c.allowedOriginsMu.RLock()
	defer c.allowedOriginsMu.RUnlock()
	
	origins := make([]string, 0, len(c.allowedOrigins))
	for origin := range c.allowedOrigins {
		origins = append(origins, origin)
	}
	return origins
}

// Handler returns the gin.HandlerFunc for CORS middleware
func (c *CORSMiddleware) Handler() gin.HandlerFunc {
	return func(cctx *gin.Context) {
		origin := cctx.Request.Header.Get("Origin")
		method := cctx.Request.Method
		path := cctx.Request.URL.Path
		
		
		// Handle preflight requests
		if method == "OPTIONS" {
			c.updateMetrics("preflight")
			c.logger.LogPreflightRequest(origin, method, path)
			
			if c.isOriginAllowed(origin) {
				c.updateMetrics("allowed")
				cctx.Header("Access-Control-Allow-Origin", origin)
				cctx.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
				cctx.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, X-Request-ID")
				cctx.Header("Access-Control-Expose-Headers", "Content-Length, X-Request-ID, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset")
				cctx.Header("Access-Control-Allow-Credentials", "true")
				cctx.Header("Access-Control-Max-Age", strconv.Itoa(c.config.MaxAge))
				cctx.AbortWithStatus(http.StatusNoContent)
				return
			} else {
				c.updateMetrics("blocked")
				c.logger.LogBlockedRequest(origin, method, path)
				c.logger.LogViolation(origin, method, path)
				cctx.AbortWithStatus(http.StatusForbidden)
				return
			}
		}
		
		// Handle actual requests
		if c.isOriginAllowed(origin) {
			c.updateMetrics("allowed")
			c.logger.LogAllowedRequest(origin, method, path)
			
			cctx.Header("Access-Control-Allow-Origin", origin)
			cctx.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
			cctx.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, X-Request-ID")
			cctx.Header("Access-Control-Expose-Headers", "Content-Length, X-Request-ID, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset")
			cctx.Header("Access-Control-Allow-Credentials", "true")
			cctx.Header("Vary", "Origin")
		} else {
			c.updateMetrics("blocked")
			c.logger.LogBlockedRequest(origin, method, path)
			
			// Only log violations for suspicious origins (not empty)
			if origin != "" {
				c.logger.LogViolation(origin, method, path)
			}
		}
		
		cctx.Next()
	}
}

// RefreshOrigins allows runtime refresh of allowed origins
func (c *CORSMiddleware) RefreshOrigins() {
	c.updateAllowedOrigins()
}

// CORS is a convenience function that creates and returns the CORS handler
func CORS(cfg config.CORSConfig) gin.HandlerFunc {
	middleware := NewCORSMiddleware(cfg)
	return middleware.Handler()
}