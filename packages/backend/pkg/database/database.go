package database

import (
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/sirupsen/logrus"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/your-org/gomeet/packages/backend/internal/config"
	"github.com/your-org/gomeet/packages/backend/internal/models"
)

func Initialize(cfg config.DatabaseConfig) (*gorm.DB, error) {
	dsn := fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%s sslmode=%s",
		cfg.Host,
		cfg.User,
		cfg.Password,
		cfg.DBName,
		cfg.Port,
		cfg.SSLMode,
	)
	
	// Disable prepared statements by using a different approach
	// We'll configure this in GORM options instead

	// Configure GORM logger with detailed logging
	gormLogger := logger.Default.LogMode(logger.Info)
	if cfg.SSLMode == "disable" {
		gormLogger = logger.Default.LogMode(logger.Info) // Keep Info for debugging
	}

	// Configure GORM with disabled prepared statements
	gormConfig := &gorm.Config{
		Logger: gormLogger,
		DisableForeignKeyConstraintWhenMigrating: true,
		PrepareStmt:                              false, // Disable prepared statements
	}

	db, err := gorm.Open(postgres.Open(dsn), gormConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Test the connection
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get database instance: %w", err)
	}

	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	logrus.Info("Database connection established successfully")

	// Run SQL file migrations first (to enable pgcrypto extension)
	if err := runSQLFileMigrations(db); err != nil {
		return nil, fmt.Errorf("failed to run SQL file migrations: %w", err)
	}

	logrus.Info("SQL file migrations completed successfully")

	// TODO: Temporarily skip auto-migrate to test SQL migrations first
	// Auto-migrate the schema
	// if err := autoMigrate(db); err != nil {
	// 	return nil, fmt.Errorf("failed to migrate database: %w", err)
	// }
	// logrus.Info("Database migration completed successfully")

	// Skip manual migrations for now to avoid prepared statement conflicts
	// TODO: Fix prepared statement issues with Supabase before enabling migrations
	logrus.Info("Skipping manual migrations due to Supabase prepared statement conflicts")

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
	// User indexes
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)").Error; err != nil {
		return fmt.Errorf("failed to create users email index: %w", err)
	}

	// Meeting indexes
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_meetings_host_id ON meetings(host_id)").Error; err != nil {
		return fmt.Errorf("failed to create meetings host_id index: %w", err)
	}

	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_meetings_start_time ON meetings(start_time)").Error; err != nil {
		return fmt.Errorf("failed to create meetings start_time index: %w", err)
	}

	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_meetings_host_start ON meetings(host_id, start_time)").Error; err != nil {
		return fmt.Errorf("failed to create meetings composite index: %w", err)
	}

	// PublicUser indexes
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_public_users_session_id ON public_users(session_id)").Error; err != nil {
		return fmt.Errorf("failed to create public_users session_id index: %w", err)
	}

	// Participant indexes
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_participants_meeting_id ON participants(meeting_id)").Error; err != nil {
		return fmt.Errorf("failed to create participants meeting_id index: %w", err)
	}

	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_participants_user_id ON participants(user_id)").Error; err != nil {
		return fmt.Errorf("failed to create participants user_id index: %w", err)
	}

	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_participants_public_user_id ON participants(public_user_id)").Error; err != nil {
		return fmt.Errorf("failed to create participants public_user_id index: %w", err)
	}

	logrus.Info("Database indexes created successfully")
	return nil
}

// runManualMigrations runs manual SQL migrations for complex schema changes
func runManualMigrations(db *gorm.DB) error {
	// Check if we need to run the participants table migration
	var migrationExists bool
	err := db.Raw(`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.table_constraints
			WHERE constraint_name = 'participants_user_check'
		)
	`).Scan(&migrationExists).Error
	
	if err != nil {
		return fmt.Errorf("failed to check migration status: %w", err)
	}
	
	if !migrationExists {
		logrus.Info("Running participants table migration...")
		
		// Run the migration to allow NULL values in user_id and public_user_id
		migrations := []string{
			// Drop existing constraints if they exist
			`ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_user_id_fkey`,
			`ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_public_user_id_fkey`,
			`ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_user_check`,
			
			// Alter columns to allow NULL values
			`ALTER TABLE participants ALTER COLUMN user_id DROP NOT NULL`,
			`ALTER TABLE participants ALTER COLUMN public_user_id DROP NOT NULL`,
			
			// Re-add foreign key constraints with ON DELETE SET NULL
			`ALTER TABLE participants ADD CONSTRAINT participants_user_id_fkey
			 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL`,
			`ALTER TABLE participants ADD CONSTRAINT participants_public_user_id_fkey
			 FOREIGN KEY (public_user_id) REFERENCES public_users(id) ON DELETE SET NULL`,
			
			// Add check constraint to ensure either user_id or public_user_id is set
			`ALTER TABLE participants ADD CONSTRAINT participants_user_check
			 CHECK (user_id IS NOT NULL OR public_user_id IS NOT NULL)`,
		}
		
		for _, migration := range migrations {
			if err := db.Exec(migration).Error; err != nil {
				// Log the error but continue - some constraints might not exist
				logrus.Warnf("Migration step failed (this might be expected): %v", err)
			}
		}
		
		logrus.Info("Participants table migration completed")
	}
	
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
	files, err := ioutil.ReadDir(migrationsDir)
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
		sqlBytes, err := ioutil.ReadFile(filePath)
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