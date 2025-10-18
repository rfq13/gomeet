package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	_ "github.com/your-org/gomeet-backend/docs" // This line is important for swag to find the docs!
	"github.com/your-org/gomeet-backend/internal/config"
	"github.com/your-org/gomeet-backend/internal/routes"
	"github.com/your-org/gomeet-backend/pkg/database"
)

// @title GoMeet Backend API
// @version 1.0
// @description This is the API server for GoMeet application
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

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	// Initialize configuration
	cfg := config.Load()

	// Initialize database
	db, err := database.Initialize(cfg.Database)
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}

	// Create database indexes for better performance
	if err := database.CreateIndexes(db); err != nil {
		log.Println("Warning: Failed to create database indexes:", err)
	}

	// Set Gin mode
	if cfg.Server.GinMode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	// Initialize router
	router := routes.Setup(db, *cfg)

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = cfg.Server.Port
	}

	log.Printf("🚀 GoMeet Backend API starting on port %s", port)
	log.Printf("📊 Database: %s:%s/%s", cfg.Database.Host, cfg.Database.Port, cfg.Database.DBName)
	log.Printf("🔧 Environment: %s", cfg.Server.GinMode)

	if err := router.Run(":" + port); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}