package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"gorm.io/gorm"

	_ "github.com/filosofine/gomeet-backend/docs" // This line is important for swag to find the docs!
	"github.com/filosofine/gomeet-backend/internal/config"
	"github.com/filosofine/gomeet-backend/internal/logger"
	"github.com/filosofine/gomeet-backend/internal/routes"
	"github.com/filosofine/gomeet-backend/pkg/database"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	// Initialize configuration
	cfg := config.Load()

	// Initialize comprehensive logger
	var logConfig logger.LogConfig
	if cfg.Server.GinMode == "release" {
		logConfig = logger.DefaultProdConfig()
		logConfig.Level = logger.LogLevel(cfg.Logging.Level)
		logConfig.Format = cfg.Logging.Format
		logConfig.Output = cfg.Logging.Output
		logConfig.FilePath = cfg.Logging.FilePath
		logConfig.MaxSize = cfg.Logging.MaxSize
		logConfig.MaxBackups = cfg.Logging.MaxBackups
		logConfig.MaxAge = cfg.Logging.MaxAge
		logConfig.Compress = cfg.Logging.Compress
		logConfig.EnableConsoleColor = cfg.Logging.EnableConsoleColor
	} else {
		logConfig = logger.DefaultDevConfig()
		logConfig.Level = logger.LogLevel(cfg.Logging.Level)
		logConfig.Format = cfg.Logging.Format
		logConfig.Output = cfg.Logging.Output
		logConfig.EnableConsoleColor = cfg.Logging.EnableConsoleColor
	}

	appLogger := logger.NewLogger(logConfig)

	// Initialize database only for services that need it
	serviceType := os.Getenv("SERVICE_TYPE")
	var db *gorm.DB
	if serviceType != "turn" && serviceType != "signaling" {
		var databaseInstance *gorm.DB
		var err error
		
		// Check if POSTGRE_URL is available (for production)
		if postgresURL := os.Getenv("POSTGRE_URL"); postgresURL != "" {
			log.Println("🔗 Using POSTGRE_URL for database connection")
			databaseInstance, err = database.InitializeWithURL(postgresURL)
		} else {
			log.Println("🔧 Using individual database config parameters")
			databaseInstance, err = database.Initialize(cfg.Database)
		}
		
		if err != nil {
			appLogger.WithField("error", err).Fatal("Failed to initialize database")
		}
		db = databaseInstance

		// Create database indexes for better performance
		appLogger.Info("Creating database indexes...")
		if err := database.CreateIndexes(databaseInstance); err != nil {
			appLogger.WithError(err).Error("Failed to create database indexes")
			appLogger.Warn("Application will continue, but performance may be impacted")
		} else {
			appLogger.Info("Database indexes created successfully")
		}
		
		// Log database connection info
		if postgresURL := os.Getenv("POSTGRE_URL"); postgresURL != "" {
			appLogger.Info("Database: Connected via POSTGRE_URL")
		} else {
			appLogger.WithFields(map[string]interface{}{
				"host":   cfg.Database.Host,
				"port":   cfg.Database.Port,
				"dbname": cfg.Database.DBName,
			}).Info("Database connection established")
		}
	} else {
		appLogger.WithField("service_type", serviceType).Info("Skipping database initialization")
		db = nil
	}

	// Set Gin mode
	if cfg.Server.GinMode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	// Initialize router
	router := routes.Setup(db, *cfg, appLogger)

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = cfg.Server.Port
	}

	appLogger.WithFields(map[string]interface{}{
		"port":       port,
		"environment": cfg.Server.GinMode,
		"service_type": os.Getenv("SERVICE_TYPE"),
		"cors_origins": cfg.CORS.AllowedOrigins,
		"database": map[string]interface{}{
			"host":   cfg.Database.Host,
			"port":   cfg.Database.Port,
			"dbname": cfg.Database.DBName,
		},
	}).Info("GoMeet Backend API starting")

	if err := router.Run(":" + port); err != nil {
		appLogger.WithError(err).Fatal("Failed to start server")
	}
}