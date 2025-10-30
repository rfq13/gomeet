package routes

import (
	"log"
	"os"

	"gorm.io/gorm"

	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"

	_ "github.com/filosofine/gomeet-backend/docs"
	"github.com/filosofine/gomeet-backend/internal/cache"
	"github.com/filosofine/gomeet-backend/internal/config"
	"github.com/filosofine/gomeet-backend/internal/controllers"
	"github.com/filosofine/gomeet-backend/internal/logger"
	"github.com/filosofine/gomeet-backend/internal/middleware"
	"github.com/filosofine/gomeet-backend/internal/redis"
	"github.com/filosofine/gomeet-backend/internal/services"

	goRedis "github.com/redis/go-redis/v9"
)

// @title GoMeet Backend API
// @version 1.0
// @description This is the API server for GoMeet application with rate limiting protection
// @termsOfService http://swagger.io/terms/

// @contact.name API Support
// @contact.url http://www.swagger.io/support
// @contact.email support@swagger.io

// @license.name MIT
// @license.url https://opensource.org/licenses/MIT

// @host localhost:8081
// @BasePath /api/v1

// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
// @description Type "Bearer" followed by a space and JWT token.

// @description Rate Limiting
// @description All API endpoints are protected by rate limiting to prevent abuse:
// @description - General endpoints: 100 requests per minute per IP
// @description - Auth endpoints: 5 requests per minute per IP
// @description - Authenticated endpoints: 1000 requests per minute per user
// @description Rate limit headers are included in all responses:
// @description - X-RateLimit-Limit: Request limit for the endpoint
// @description - X-RateLimit-Remaining: Remaining requests in current window
// @description - X-RateLimit-Reset: Unix timestamp when window resets
// @description When rate limited, returns 429 status with retry information.

func Setup(db *gorm.DB, cfg config.Config, appLogger *logger.Logger) *gin.Engine {
	router := gin.New()

	// Initialize CORS middleware
	corsMiddleware := middleware.NewCORSMiddleware(cfg.CORS)
	
	// Initialize logging middleware
	loggingMiddleware := middleware.NewLoggingMiddleware(appLogger)
	
	// Add middleware
	router.Use(loggingMiddleware.LoggingInterceptor())
	router.Use(loggingMiddleware.RecoveryLogger())
	router.Use(loggingMiddleware.ErrorLogger())
	router.Use(middleware.RequestID())
	router.Use(corsMiddleware.Handler())

	// Initialize Redis client wrapper and raw client
	var redisClientWrapper *redis.RedisClient
	var rawRedisClient *goRedis.Client
	
	redisClientWrapper = redis.NewRedisClient(&cfg.Redis)
	
	// Also initialize raw Redis client for services that need it
	if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
		log.Println("🔗 Using REDIS_URL for Redis connection")
		// Parse Redis URL and create client
		opt, err := goRedis.ParseURL(redisURL)
		if err != nil {
			log.Fatalf("Failed to parse REDIS_URL: %v", err)
		}
		rawRedisClient = goRedis.NewClient(opt)
	} else {
		log.Println("🔧 Using individual Redis config parameters")
		redisAddr := cfg.Redis.Host + ":" + cfg.Redis.Port
		rawRedisClient = goRedis.NewClient(&goRedis.Options{
			Addr:     redisAddr,
			Password: cfg.Redis.Password,
		})
	}

	// Initialize services based on service type
	var jwtService *services.JWTService
	var authService *services.AuthService
	var meetingService *services.MeetingService
	var publicUserService *services.PublicUserService
	var websocketService *services.WebSocketService
	var webrtcService *services.WebRTCService
	var chatService *services.ChatService
	var featureFlagService *services.FeatureFlagService
	var rateLimiterService *services.RateLimiterService
	var turnService *services.TurnService
	
	// Initialize controllers based on service type
	var authController *controllers.AuthController
	var meetingController *controllers.MeetingController
	var publicUserController *controllers.PublicUserController
	var websocketController *controllers.WebSocketController
	var webrtcController *controllers.WebRTCController
	var chatController *controllers.ChatController
	var featureFlagController *controllers.FeatureFlagController
	var corsController *controllers.CORSController
	var turnController *controllers.TurnController
	
	var authMiddleware *middleware.AuthMiddleware
	var rateLimiterMiddleware *middleware.RateLimiterMiddleware

	// Only initialize database-dependent services if db is available
	if db != nil {
		// Initialize cache repository
		cacheRepo := cache.NewCacheRepository(redisClientWrapper)
		
		jwtService = services.NewJWTService(cfg.JWT)
		authService = services.NewAuthService(db, jwtService, cacheRepo)
		meetingService = services.NewMeetingService(db, cacheRepo)
		publicUserService = services.NewPublicUserService(db, cacheRepo)
		
		// Initialize WebSocket service first without WebRTC dependency
		websocketService = services.NewWebSocketService(db, jwtService, nil)
		
		// Initialize WebRTC service
		webrtcService = services.NewWebRTCService(db, websocketService, &cfg)
		
		// Set WebRTC service reference in WebSocket service (breaking circular dependency)
		websocketService.SetWebRTCService(webrtcService)
		
		chatService = services.NewChatService(db, websocketService, publicUserService)
		
		// Initialize feature flag service
		featureFlagService = services.NewFeatureFlagService(rawRedisClient, db, cacheRepo)
		
		// Initialize rate limiter service
		rateLimiterService = services.NewRateLimiterService(rawRedisClient, cfg.RateLimit)
		
		// Initialize TURN service
		turnService = services.NewTurnService(db, rawRedisClient, cfg.TURN.Secret, cfg.TURN.Server)
		
		// Start WebSocket hub
		websocketService.StartHub()

		// Initialize controllers
		authController = controllers.NewAuthController(authService)
		meetingController = controllers.NewMeetingController(meetingService)
		publicUserController = controllers.NewPublicUserController(publicUserService)
		websocketController = controllers.NewWebSocketController(websocketService, db)
		webrtcController = controllers.NewWebRTCController(webrtcService, turnService, db, redisClientWrapper)
		chatController = controllers.NewChatController(chatService)
		featureFlagController = controllers.NewFeatureFlagController(featureFlagService)
		corsController = controllers.NewCORSController(corsMiddleware)
		turnController = controllers.NewTurnController(turnService, &cfg)

		// Initialize middleware
		authMiddleware = middleware.NewAuthMiddleware(jwtService)
		rateLimiterMiddleware = middleware.NewRateLimiterMiddleware(rateLimiterService)
		
		// Add rate limiting middleware for all endpoints
		if rateLimiterService != nil && rateLimiterService.IsEnabled() {
			router.Use(rateLimiterMiddleware.RateLimit(middleware.RateLimitGeneral))
		}
	}

	// Swagger documentation
	router.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	// API v1 routes - only add routes if controllers are initialized
if db != nil {
	api := router.Group("/api")
	// Add handler for /api/v1 without trailing slash
	api.GET("/", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"message": "GoMeet API is running",
		})
	})

	// Health check endpoint
	api.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status": "healthy",
			"message": "GoMeet Backend API is running",
		})
	})

	v1 := api.Group("/v1")
	{
		// API root endpoint
		v1.GET("/", func(c *gin.Context) {
			c.JSON(200, gin.H{
				"message": "GoMeet API v1 is running",
				"version": "1.0.0",
				"endpoints": gin.H{
					"auth":     "/api/v1/auth",
					"meetings": "/api/v1/meetings",
					"chat":     "/api/v1/chat",
					"ws":       "/api/v1/ws",
					"public-users": "/api/v1/public-users",
					"webrtc":   "/api/v1/webrtc",
					"turn":     "/api/v1/turn",
					"feature-flags": "/api/v1/feature-flags",
				},
			})
		})
			// Authentication routes
			if authController != nil {
				auth := v1.Group("/auth")
				// Apply stricter rate limiting for auth endpoints
				if rateLimiterMiddleware != nil {
					auth.Use(rateLimiterMiddleware.RateLimit(middleware.RateLimitAuth))
				}
				{
					auth.POST("/register", authController.Register)
					auth.POST("/login", authController.Login)
					auth.POST("/refresh", authController.RefreshToken)
					auth.POST("/logout", authController.Logout)
					auth.POST("/check-password-strength", authController.CheckPasswordStrength)
					
					// Protected auth routes
					if authMiddleware != nil {
						authProtected := auth.Group("/")
						authProtected.Use(authMiddleware.RequireAuth())
						{
							authProtected.GET("/me", authController.GetMe)
							authProtected.PUT("/update-password", authController.UpdatePassword)
							authProtected.PUT("/update-profile", authController.UpdateProfile)
						}
					}
				}
			}

			// Meeting routes
			if meetingController != nil {
				v1.GET("/meetings/:id/participants/public", meetingController.GetMeetingParticipantsPublic)
				v1.GET("/meetings/:id/public", meetingController.GetMeetingPublic)
				
				if authMiddleware != nil {
					meetings := v1.Group("/meetings")
					meetings.Use(authMiddleware.RequireAuth())
					// Apply authenticated rate limiting for protected meeting routes
					if rateLimiterMiddleware != nil {
						meetings.Use(rateLimiterMiddleware.RateLimit(middleware.RateLimitAuthenticated))
					}
					{
						meetings.GET("", meetingController.GetMeetings)
						meetings.POST("", meetingController.CreateMeeting)
						meetings.GET("/upcoming", meetingController.GetUpcomingMeetings)
						meetings.GET("/past", meetingController.GetPastMeetings)
						meetings.GET("/:id", meetingController.GetMeeting)
						meetings.PUT("/:id", meetingController.UpdateMeeting)
						meetings.DELETE("/:id", meetingController.DeleteMeeting)
					}
				}
			}
			
			// Public user routes
			if publicUserController != nil {
				publicUsers := v1.Group("/public-users")
				{
					publicUsers.POST("", publicUserController.CreatePublicUser)
					publicUsers.POST("/join-meeting", publicUserController.JoinMeetingAsPublicUser)
					publicUsers.POST("/leave-meeting", publicUserController.LeaveMeetingAsPublicUser)
					publicUsers.GET("/session/:session_id", publicUserController.GetPublicUserBySessionID)
				}
			}

			// User routes (protected)
			if authMiddleware != nil {
				users := v1.Group("/users")
				users.Use(authMiddleware.RequireAuth())
				// Apply authenticated rate limiting for user routes
				if rateLimiterMiddleware != nil {
					users.Use(rateLimiterMiddleware.RateLimit(middleware.RateLimitAuthenticated))
				}
				{
					users.GET("/profile", func(c *gin.Context) {
						c.JSON(200, gin.H{"message": "User profile endpoint - to be implemented"})
					})
				}
			}

			// WebRTC routes (protected)
			if webrtcController != nil && authMiddleware != nil {
				webrtc := v1.Group("/webrtc")
				webrtc.Use(authMiddleware.RequireAuth())
				// Apply authenticated rate limiting for WebRTC routes
				if rateLimiterMiddleware != nil {
					webrtc.Use(rateLimiterMiddleware.RateLimit(middleware.RateLimitAuthenticated))
				}
				{
					webrtc.GET("/meetings/:id/peers", webrtcController.GetMeetingPeers)
					webrtc.POST("/meetings/:id/join", webrtcController.JoinMeeting)
					webrtc.POST("/meetings/:id/leave", webrtcController.LeaveMeeting)
					webrtc.POST("/meetings/:id/offer", webrtcController.SendOffer)
					webrtc.POST("/meetings/:id/answer", webrtcController.SendAnswer)
					webrtc.POST("/meetings/:id/ice-candidate", webrtcController.SendIceCandidate)
					webrtc.PUT("/meetings/:id/peer-state", webrtcController.UpdatePeerState)
					webrtc.GET("/meetings/:id/stats", webrtcController.GetRoomStats)
					webrtc.GET("/meetings/:id/webrtc-stats", webrtcController.GetWebRTCStats)
					webrtc.POST("/meetings/:id/optimize", webrtcController.OptimizeRoom)
					webrtc.POST("/token", webrtcController.GetLiveKitToken)
				}
			}

			// TURN server routes (protected)
			if turnController != nil && authMiddleware != nil {
				turn := v1.Group("/turn")
				turn.Use(authMiddleware.RequireAuth())
				// Apply authenticated rate limiting for TURN routes
				if rateLimiterMiddleware != nil {
					turn.Use(rateLimiterMiddleware.RateLimit(middleware.RateLimitAuthenticated))
				}
				{
					turn.GET("/credentials", turnController.GetTurnCredentials)
					turn.GET("/ice-servers", turnController.GetICEServers)
					turn.DELETE("/credentials/:username", turnController.RevokeTurnCredentials)
					turn.GET("/stats", turnController.GetTurnStats)
				}
			}

			// Feature flag routes (protected)
			if featureFlagController != nil && authMiddleware != nil {
				featureFlags := v1.Group("/feature-flags")
				featureFlags.Use(authMiddleware.RequireAuth())
				// Apply authenticated rate limiting for feature flag routes
				if rateLimiterMiddleware != nil {
					featureFlags.Use(rateLimiterMiddleware.RateLimit(middleware.RateLimitAuthenticated))
				}
				{
					featureFlags.GET("/config", featureFlagController.GetFeatureConfig)
					featureFlags.GET("/all", featureFlagController.GetAllFlags)
					featureFlags.POST("/set", featureFlagController.SetFlag)
					featureFlags.GET("/:flag", featureFlagController.IsFlagEnabled)
					featureFlags.POST("/batch-set", featureFlagController.BatchSetFlags)
					featureFlags.GET("/migration/stats", featureFlagController.GetMigrationStats)
					featureFlags.GET("/migration/phase", featureFlagController.GetMigrationPhase)
					featureFlags.POST("/cleanup", featureFlagController.CleanupExpiredFlags)
				}
			}

			// CORS monitoring routes (protected)
			if corsController != nil && authMiddleware != nil {
				cors := v1.Group("/cors")
				cors.Use(authMiddleware.RequireAuth())
				{
					cors.GET("/metrics", corsController.GetMetrics)
					cors.POST("/metrics/reset", corsController.ResetMetrics)
					cors.POST("/refresh", corsController.RefreshOrigins)
					cors.GET("/config", corsController.GetConfig)
					cors.GET("/violations", corsController.GetViolations)
				}
			}

			// Chat routes
			if chatController != nil {
				meetingsChat := v1.Group("/meetings/:id")
				{
					meetingsChat.GET("/messages", chatController.GetMessages)
					meetingsChat.POST("/messages", chatController.SendMessage)
					meetingsChat.POST("/messages/:messageId/read", chatController.MarkMessageRead)
					meetingsChat.POST("/messages/:messageId/reactions", chatController.ToggleReaction)
					meetingsChat.GET("/messages/unread-count", chatController.GetUnreadCount)
					
					if authMiddleware != nil {
						meetingsChat.PUT("/messages/:messageId", authMiddleware.RequireAuth(), chatController.UpdateMessage)
					}
				}
			}

			// WebSocket routes
			if websocketController != nil {
				ws := v1.Group("/ws")
				{
					ws.GET("/meetings/:id", websocketController.HandleWebSocket)
					
					if authMiddleware != nil {
						wsProtected := ws.Group("/")
						wsProtected.Use(authMiddleware.RequireAuth())
						{
							wsProtected.GET("/meetings/:id/participants", websocketController.GetMeetingParticipants)
							wsProtected.GET("/meetings/:id/participants/count", websocketController.GetParticipantCount)
							wsProtected.POST("/meetings/:id/send", websocketController.SendMessageToMeeting)
						}
					}
				}
			}
		}
	}

	return router
}
