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

	// Initialize services
	jwtService := services.NewJWTService(cfg.JWT)
	authService := services.NewAuthService(db, jwtService)
	meetingService := services.NewMeetingService(db)
	publicUserService := services.NewPublicUserService(db)
	
	// Initialize WebSocket service first without WebRTC dependency
	websocketService := services.NewWebSocketService(db, jwtService, nil)
	
	// Initialize WebRTC service
	webrtcService := services.NewWebRTCService(db, websocketService)
	
	// Set WebRTC service reference in WebSocket service (breaking circular dependency)
	websocketService.SetWebRTCService(webrtcService)
	
	chatService := services.NewChatService(db, websocketService, publicUserService)
	
	// Initialize feature flag service
	featureFlagService := services.NewFeatureFlagService(redisClient, db)
	
	// TEMPORARILY DISABLED FOR EMERGENCY WEBSOCKET FIX
	// Initialize TURN service
	// turnService := services.NewTurnService(db, redisClient, cfg.TURN.Secret, cfg.TURN.Server)

	// Start WebSocket hub
	websocketService.StartHub()

	// Initialize controllers
	authController := controllers.NewAuthController(authService)
	meetingController := controllers.NewMeetingController(meetingService)
	publicUserController := controllers.NewPublicUserController(publicUserService)
	websocketController := controllers.NewWebSocketController(websocketService, db)
	webrtcController := controllers.NewWebRTCController(webrtcService, db)
	chatController := controllers.NewChatController(chatService)
	featureFlagController := controllers.NewFeatureFlagController(featureFlagService)
	// turnController := controllers.NewTurnController(turnService)

	// Initialize middleware
	authMiddleware := middleware.NewAuthMiddleware(jwtService)

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status": "healthy",
			"message": "GoMeet Backend API is running",
		})
	})

	// Swagger documentation
	router.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	// API v1 routes
	v1 := router.Group("/api/v1")
	{
		// Authentication routes
		auth := v1.Group("/auth")
		{
			auth.POST("/register", authController.Register)
			auth.POST("/login", authController.Login)
			auth.POST("/refresh", authController.RefreshToken)
			auth.POST("/logout", authController.Logout)
			
			// Protected auth routes
			authProtected := auth.Group("/")
			authProtected.Use(authMiddleware.RequireAuth())
			{
				authProtected.GET("/me", authController.GetMe)
				authProtected.PUT("/update-password", authController.UpdatePassword)
				authProtected.PUT("/update-profile", authController.UpdateProfile)
			}
		}

		v1.GET("/meetings/:id/participants/public", meetingController.GetMeetingParticipantsPublic)
		v1.GET("/meetings/:id/public", meetingController.GetMeetingPublic)
		// Meeting routes (protected)
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
		
		// Public user routes (no authentication required)
		publicUsers := v1.Group("/public-users")
		{
			publicUsers.POST("", publicUserController.CreatePublicUser)
			publicUsers.POST("/join-meeting", publicUserController.JoinMeetingAsPublicUser)
			publicUsers.POST("/leave-meeting", publicUserController.LeaveMeetingAsPublicUser)
			// get public user by ID
			publicUsers.GET("/session/:session_id", publicUserController.GetPublicUserBySessionID)
		}

		// User routes (protected)
		users := v1.Group("/users")
		users.Use(authMiddleware.RequireAuth())
		{
			users.GET("/profile", func(c *gin.Context) {
				c.JSON(200, gin.H{"message": "User profile endpoint - to be implemented"})
			})
		}

		// WebRTC routes (protected)
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


		// Feature flag routes (protected)
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

		// Chat routes (mixed auth - supports both authenticated and public users)
		// Chat message routes for meetings - integrated with meetings routes
		meetingsChat := v1.Group("/meetings/:id")
		{
			// Get messages (supports both auth and public users via sessionId query param)
			meetingsChat.GET("/messages", chatController.GetMessages)
			
			// Send message (supports both auth and public users via sessionId query param)
			meetingsChat.POST("/messages", chatController.SendMessage)
			
			// Mark message as read (supports both auth and public users via sessionId query param)
			meetingsChat.POST("/messages/:messageId/read", chatController.MarkMessageRead)
			
			// Toggle reaction (supports both auth and public users via sessionId query param)
			meetingsChat.POST("/messages/:messageId/reactions", chatController.ToggleReaction)
			
			// Get unread count (supports both auth and public users via sessionId query param)
			meetingsChat.GET("/messages/unread-count", chatController.GetUnreadCount)
			
			// Update message (authenticated users only)
			meetingsChat.PUT("/messages/:messageId", authMiddleware.RequireAuth(), chatController.UpdateMessage)
		}

		// WebSocket routes
		ws := v1.Group("/ws")
		{
			// WebSocket endpoint for meeting rooms (optional auth - supports both authenticated and public users)
			ws.GET("/meetings/:id", websocketController.HandleWebSocket)
			
			// WebSocket management endpoints (protected)
			wsProtected := ws.Group("/")
			wsProtected.Use(authMiddleware.RequireAuth())
			{
				wsProtected.GET("/meetings/:id/participants", websocketController.GetMeetingParticipants)
				wsProtected.GET("/meetings/:id/participants/count", websocketController.GetParticipantCount)
				wsProtected.POST("/meetings/:id/send", websocketController.SendMessageToMeeting)
			}
		}

		// TEMPORARILY DISABLED FOR EMERGENCY WEBSOCKET FIX
		// TURN routes (protected)
		// turn := v1.Group("/turn")
		// turn.Use(authMiddleware.RequireAuth())
		// {
		// 	turn.POST("/credentials", turnController.GenerateCredentials)
		// 	turn.GET("/ice-servers", turnController.GetICEServers)
		// 	turn.GET("/validate", turnController.ValidateCredentials)
		// 	turn.POST("/revoke", turnController.RevokeCredentials)
		// 	turn.POST("/log-usage", turnController.LogUsage)
		// 	turn.GET("/stats", turnController.GetStats)
		// 	turn.POST("/cleanup", turnController.CleanupExpiredCredentials)
		// 	turn.GET("/test-connectivity", turnController.TestConnectivity)
		// 	turn.GET("/server-info", turnController.GetServerInfo)
		// }
	}

	return router
}
