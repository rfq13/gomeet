package routes

import (
	"gorm.io/gorm"

	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"

	_ "github.com/your-org/gomeet/packages/backend/docs"
	"github.com/your-org/gomeet/packages/backend/internal/config"
	"github.com/your-org/gomeet/packages/backend/internal/controllers"
	"github.com/your-org/gomeet/packages/backend/internal/middleware"
	"github.com/your-org/gomeet/packages/backend/internal/services"

	"github.com/redis/go-redis/v9"
)

func Setup(db *gorm.DB, cfg config.Config) *gin.Engine {
	router := gin.New()

	// Add middleware
	router.Use(gin.Logger())
	router.Use(gin.Recovery())
	router.Use(middleware.RequestID())
	router.Use(middleware.CORS(cfg.CORS.AllowedOrigins))

	// Initialize Redis client
	redisAddr := cfg.Redis.Host + ":" + cfg.Redis.Port
	redisClient := redis.NewClient(&redis.Options{
		Addr:     redisAddr,
		Password: cfg.Redis.Password,
	})

	// Initialize services based on service type
	var jwtService *services.JWTService
	var authService *services.AuthService
	var meetingService *services.MeetingService
	var publicUserService *services.PublicUserService
	var websocketService *services.WebSocketService
	var webrtcService *services.WebRTCService
	var chatService *services.ChatService
	var featureFlagService *services.FeatureFlagService
	
	// Initialize controllers based on service type
	var authController *controllers.AuthController
	var meetingController *controllers.MeetingController
	var publicUserController *controllers.PublicUserController
	var websocketController *controllers.WebSocketController
	var webrtcController *controllers.WebRTCController
	var chatController *controllers.ChatController
	var featureFlagController *controllers.FeatureFlagController
	
	var authMiddleware *middleware.AuthMiddleware

	// Only initialize database-dependent services if db is available
	if db != nil {
		jwtService = services.NewJWTService(cfg.JWT)
		authService = services.NewAuthService(db, jwtService)
		meetingService = services.NewMeetingService(db)
		publicUserService = services.NewPublicUserService(db)
		
		// Initialize WebSocket service first without WebRTC dependency
		websocketService = services.NewWebSocketService(db, jwtService, nil)
		
		// Initialize WebRTC service
		webrtcService = services.NewWebRTCService(db, websocketService)
		
		// Set WebRTC service reference in WebSocket service (breaking circular dependency)
		websocketService.SetWebRTCService(webrtcService)
		
		chatService = services.NewChatService(db, websocketService, publicUserService)
		
		// Initialize feature flag service
		featureFlagService = services.NewFeatureFlagService(redisClient, db)
		
		// Start WebSocket hub
		websocketService.StartHub()

		// Initialize controllers
		authController = controllers.NewAuthController(authService)
		meetingController = controllers.NewMeetingController(meetingService)
		publicUserController = controllers.NewPublicUserController(publicUserService)
		websocketController = controllers.NewWebSocketController(websocketService, db)
		webrtcController = controllers.NewWebRTCController(webrtcService, db)
		chatController = controllers.NewChatController(chatService)
		featureFlagController = controllers.NewFeatureFlagController(featureFlagService)

		// Initialize middleware
		authMiddleware = middleware.NewAuthMiddleware(jwtService)
	}

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status": "healthy",
			"message": "GoMeet Backend API is running",
		})
	})

	// Swagger documentation
	router.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	// API v1 routes - only add routes if controllers are initialized
if db != nil {
		// Add handler for /api/v1 without trailing slash
		router.GET("/api/v1", func(c *gin.Context) {
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
					"feature-flags": "/api/v1/feature-flags",
				},
			})
		})
	v1 := router.Group("/api/v1")
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
					"feature-flags": "/api/v1/feature-flags",
				},
			})
		})
			// Authentication routes
			if authController != nil {
				auth := v1.Group("/auth")
				{
					auth.POST("/register", authController.Register)
					auth.POST("/login", authController.Login)
					auth.POST("/refresh", authController.RefreshToken)
					auth.POST("/logout", authController.Logout)
					
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
				{
					webrtc.GET("/meetings/:id/peers", webrtcController.GetMeetingPeers)
					webrtc.POST("/meetings/:id/join", webrtcController.JoinMeeting)
					webrtc.POST("/meetings/:id/leave", webrtcController.LeaveMeeting)
					webrtc.POST("/meetings/:id/offer", webrtcController.SendOffer)
					webrtc.POST("/meetings/:id/answer", webrtcController.SendAnswer)
					webrtc.POST("/meetings/:id/ice-candidate", webrtcController.SendIceCandidate)
					webrtc.PUT("/meetings/:id/peer-state", webrtcController.UpdatePeerState)
					webrtc.GET("/meetings/:id/stats", webrtcController.GetRoomStats)
				}
			}

			// Feature flag routes (protected)
			if featureFlagController != nil && authMiddleware != nil {
				featureFlags := v1.Group("/feature-flags")
				featureFlags.Use(authMiddleware.RequireAuth())
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
