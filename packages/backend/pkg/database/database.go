package database

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/sirupsen/logrus"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/filosofine/gomeet-backend/internal/config"
	"github.com/filosofine/gomeet-backend/internal/models"
)

func Initialize(cfg config.DatabaseConfig) (*gorm.DB, error) {
	// Build DSN with basic parameters only
	dsn := fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%s sslmode=%s",
		cfg.Host,
		cfg.User,
		cfg.Password,
		cfg.DBName,
		cfg.Port,
		cfg.SSLMode,
	)

	return InitializeWithDSN(dsn)
}

// InitializeWithURL initializes database connection using a direct PostgreSQL URL
func InitializeWithURL(postgresURL string) (*gorm.DB, error) {
	return InitializeWithDSN(postgresURL)
}

// InitializeWithDSN initializes database connection using a DSN string
func InitializeWithDSN(dsn string) (*gorm.DB, error) {

	// Configure GORM logger with detailed logging
	gormLogger := logger.Default.LogMode(logger.Info)

	// Parse the DSN using pgx to configure driver-level options
	pgxConfig, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to parse pgx config: %w", err)
	}

	// Set PreferSimpleProtocol to true to force simple query protocol (no PREPARE/EXECUTE)
	pgxConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	// Create a database connection using pgx driver with simple protocol
	sqlDB := stdlib.OpenDB(*pgxConfig)

	// Configure GORM with disabled prepared statements and custom driver
	gormConfig := &gorm.Config{
		Logger: gormLogger,
		DisableForeignKeyConstraintWhenMigrating: true,
		PrepareStmt:                              false, // Disable prepared statements at GORM level
	}

	// Open GORM with the custom pgx database connection
	db, err := gorm.Open(postgres.New(postgres.Config{
		Conn: sqlDB,
	}), gormConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Test the connection
	dbSQL, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get database instance: %w", err)
	}

	if err := dbSQL.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}
	
	// Clear any existing prepared statements
	if _, err := dbSQL.Exec("DISCARD ALL"); err != nil {
		logrus.Warnf("Failed to discard prepared statements: %v", err)
	}

	logrus.Info("Database connection established successfully")
	logrus.Info("Driver-level protection enabled: pgx QueryExecModeSimpleProtocol")
	logrus.Info("GORM-level protection enabled: PrepareStmt=false")
	logrus.Info("2-layer prepared statement conflict protection is now active")

	// Run SQL file migrations first (to enable pgcrypto extension)
	if err := runSQLFileMigrations(db); err != nil {
		return nil, fmt.Errorf("failed to run SQL file migrations: %w", err)
	}

	logrus.Info("SQL file migrations completed successfully")

	// Auto-migrate the schema - temporarily disabled for debugging
	// if err := autoMigrate(db); err != nil {
	// 	return nil, fmt.Errorf("failed to migrate database: %w", err)
	// }
	logrus.Info("Database migration skipped for debugging - using SQL migrations only")

	return db, nil
}

func autoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&models.User{},
		&models.PublicUser{},
		&models.Meeting{},
		&models.Participant{},
	)
}

// CreateIndexes creates database indexes for better performance
func CreateIndexes(db *gorm.DB) error {
	logrus.Info("Starting database indexes creation...")
	
	// User indexes
	logrus.Info("Creating index: idx_users_email on users(email)")
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)").Error; err != nil {
		logrus.Errorf("Failed to create users email index: %v", err)
		return fmt.Errorf("failed to create users email index: %w", err)
	}
	logrus.Info("✓ Successfully created index: idx_users_email")

	// Meeting indexes
	logrus.Info("Creating index: idx_meetings_host_id on meetings(host_id)")
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_meetings_host_id ON meetings(host_id)").Error; err != nil {
		logrus.Errorf("Failed to create meetings host_id index: %v", err)
		return fmt.Errorf("failed to create meetings host_id index: %w", err)
	}
	logrus.Info("✓ Successfully created index: idx_meetings_host_id")

	logrus.Info("Creating index: idx_meetings_start_time on meetings(start_time)")
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_meetings_start_time ON meetings(start_time)").Error; err != nil {
		logrus.Errorf("Failed to create meetings start_time index: %v", err)
		return fmt.Errorf("failed to create meetings start_time index: %w", err)
	}
	logrus.Info("✓ Successfully created index: idx_meetings_start_time")

	logrus.Info("Creating composite index: idx_meetings_host_start on meetings(host_id, start_time)")
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_meetings_host_start ON meetings(host_id, start_time)").Error; err != nil {
		logrus.Errorf("Failed to create meetings composite index: %v", err)
		return fmt.Errorf("failed to create meetings composite index: %w", err)
	}
	logrus.Info("✓ Successfully created index: idx_meetings_host_start")

	// PublicUser indexes
	logrus.Info("Creating index: idx_public_users_session_id on public_users(session_id)")
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_public_users_session_id ON public_users(session_id)").Error; err != nil {
		logrus.Errorf("Failed to create public_users session_id index: %v", err)
		return fmt.Errorf("failed to create public_users session_id index: %w", err)
	}
	logrus.Info("✓ Successfully created index: idx_public_users_session_id")

	// Participant indexes
	logrus.Info("Creating index: idx_participants_meeting_id on participants(meeting_id)")
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_participants_meeting_id ON participants(meeting_id)").Error; err != nil {
		logrus.Errorf("Failed to create participants meeting_id index: %v", err)
		return fmt.Errorf("failed to create participants meeting_id index: %w", err)
	}
	logrus.Info("✓ Successfully created index: idx_participants_meeting_id")

	logrus.Info("Creating index: idx_participants_user_id on participants(user_id)")
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_participants_user_id ON participants(user_id)").Error; err != nil {
		logrus.Errorf("Failed to create participants user_id index: %v", err)
		return fmt.Errorf("failed to create participants user_id index: %w", err)
	}
	logrus.Info("✓ Successfully created index: idx_participants_user_id")

	logrus.Info("Creating index: idx_participants_public_user_id on participants(public_user_id)")
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_participants_public_user_id ON participants(public_user_id)").Error; err != nil {
		logrus.Errorf("Failed to create participants public_user_id index: %v", err)
		return fmt.Errorf("failed to create participants public_user_id index: %w", err)
	}
	logrus.Info("✓ Successfully created index: idx_participants_public_user_id")

	logrus.Info("🎉 All database indexes created successfully (8 indexes total)")
	return nil
}


// runSQLFileMigrations runs SQL migrations from files in the migrations directory
func runSQLFileMigrations(db *gorm.DB) error {
	// Get the path to the migrations directory
	migrationsDir := "migrations"
	
	// Check if the migrations directory exists
	if _, err := os.Stat(migrationsDir); os.IsNotExist(err) {
		logrus.Info("Migrations directory does not exist, skipping SQL file migrations")
		return nil
	}
	
	// Read all files in the migrations directory
	files, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("failed to read migrations directory: %w", err)
	}
	
	// Filter for SQL files and sort them by filename
	var sqlFiles []string
	for _, file := range files {
		if !file.IsDir() && strings.HasSuffix(file.Name(), ".sql") {
			sqlFiles = append(sqlFiles, file.Name())
		}
	}
	
	sort.Strings(sqlFiles)
	
	// Create a migrations table if it doesn't exist to track applied migrations
	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) PRIMARY KEY,
			applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		)
	`).Error; err != nil {
		return fmt.Errorf("failed to create schema_migrations table: %w", err)
	}
	
	// Run each migration file in order
	for _, filename := range sqlFiles {
		// Extract version number from filename (e.g., "000_enable_pgcrypto.sql" -> "000")
		version := strings.Split(filename, "_")[0]
		
		// Check if this migration has already been applied
		var applied bool
		if err := db.Raw("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?)", version).Scan(&applied).Error; err != nil {
			return fmt.Errorf("failed to check migration status for version %s: %w", version, err)
		}
		
		if applied {
			logrus.Infof("Migration %s already applied, skipping", filename)
			continue
		}
		
		logrus.Infof("Applying migration %s", filename)
		
		// Read the SQL file
		filePath := filepath.Join(migrationsDir, filename)
		sqlBytes, err := os.ReadFile(filePath)
		if err != nil {
			return fmt.Errorf("failed to read migration file %s: %w", filename, err)
		}
		
		// Execute the SQL
		if err := db.Exec(string(sqlBytes)).Error; err != nil {
			return fmt.Errorf("failed to execute migration %s: %w", filename, err)
		}
		
		// Record the migration as applied
		if err := db.Exec("INSERT INTO schema_migrations (version) VALUES (?)", version).Error; err != nil {
			return fmt.Errorf("failed to record migration %s as applied: %w", filename, err)
		}
		
		logrus.Infof("Successfully applied migration %s", filename)
	}
	
	return nil
}