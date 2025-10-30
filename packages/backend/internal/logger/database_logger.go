package logger

import (
	"context"
	"time"

	"gorm.io/gorm/logger"
)

// DatabaseLogger wraps GORM with comprehensive logging
type DatabaseLogger struct {
	logger *Logger
	config DatabaseLogConfig
}

// DatabaseLogConfig represents database logging configuration
type DatabaseLogConfig struct {
	Enabled         bool
	SlowThreshold   time.Duration
	LogLevel        string // "info", "warn", "error"
	IgnoreErrNoRows bool
	IgnoreRecordNotFound bool
}

// NewDatabaseLogger creates a new database logger
func NewDatabaseLogger(logger *Logger, config DatabaseLogConfig) *DatabaseLogger {
	return &DatabaseLogger{
		logger: logger,
		config: config,
	}
}

// GormLogger implements GORM's logger interface
type GormLogger struct {
	dbLogger *DatabaseLogger
}

// NewGormLogger creates a new GORM-compatible logger
func NewGormLogger(dbLogger *DatabaseLogger) *GormLogger {
	return &GormLogger{
		dbLogger: dbLogger,
	}
}

// LogMode implements GORM logger interface
func (l *GormLogger) LogMode(level logger.LogLevel) logger.Interface {
	// For simplicity, we'll return the same logger
	// In a more sophisticated implementation, you could create different loggers for different levels
	return l
}

// Info implements GORM logger interface
func (l *GormLogger) Info(ctx context.Context, msg string, data ...interface{}) {
	if !l.dbLogger.config.Enabled {
		return
	}

	logCtx := l.dbLogger.logger.WithContextValue(ctx)
	logCtx.Component = "database"
	logCtx.Operation = "info"

	l.dbLogger.logger.WithContext(logCtx).Infof(msg, data...)
}

// Warn implements GORM logger interface
func (l *GormLogger) Warn(ctx context.Context, msg string, data ...interface{}) {
	if !l.dbLogger.config.Enabled {
		return
	}

	logCtx := l.dbLogger.logger.WithContextValue(ctx)
	logCtx.Component = "database"
	logCtx.Operation = "warning"

	l.dbLogger.logger.WithContext(logCtx).Warnf(msg, data...)
}

// Error implements GORM logger interface
func (l *GormLogger) Error(ctx context.Context, msg string, data ...interface{}) {
	if !l.dbLogger.config.Enabled {
		return
	}

	logCtx := l.dbLogger.logger.WithContextValue(ctx)
	logCtx.Component = "database"
	logCtx.Operation = "error"

	l.dbLogger.logger.WithContext(logCtx).Errorf(msg, data...)
}

// Trace implements GORM logger interface for SQL query logging
func (l *GormLogger) Trace(ctx context.Context, begin time.Time, fc func() (sql string, rowsAffected int64), err error) {
	if !l.dbLogger.config.Enabled {
		return
	}

	elapsed := time.Since(begin)
	sql, rows := fc()

	logCtx := l.dbLogger.logger.WithContextValue(ctx)
	logCtx.Component = "database"
	logCtx.Duration = elapsed

	// Skip logging if configured to ignore certain errors
	if l.dbLogger.config.IgnoreErrNoRows && err != nil && err.Error() == "record not found" {
		return
	}

	if l.dbLogger.config.IgnoreRecordNotFound && err != nil && err.Error() == "gorm: record not found" {
		return
	}

	// Determine log level based on error and duration
	logLevel := "info"
	if err != nil {
		logLevel = "error"
	} else if elapsed > l.dbLogger.config.SlowThreshold {
		logLevel = "warn"
	}

	// Prepare log entry
	entry := l.dbLogger.logger.WithContext(logCtx).
		WithField("sql", sql).
		WithField("rows_affected", rows).
		WithField("duration_ms", elapsed.Milliseconds())

	message := "Database query executed"
	
	switch logLevel {
	case "error":
		entry = entry.WithError(err)
		message = "Database query failed"
		l.dbLogger.logger.WithContext(logCtx).WithError(err).Error(message)
	case "warn":
		message = "Slow database query detected"
		l.dbLogger.logger.WithContext(logCtx).Warn(message)
	default:
		l.dbLogger.logger.WithContext(logCtx).Info(message)
	}

	// Log additional context for slow queries
	if elapsed > l.dbLogger.config.SlowThreshold {
		l.dbLogger.logger.LogPerformance(logCtx, "slow_database_query", elapsed, map[string]interface{}{
			"sql":           sql,
			"rows_affected": rows,
			"threshold":     l.dbLogger.config.SlowThreshold.String(),
		})
	}
}

// LogConnection logs database connection events
func (dl *DatabaseLogger) LogConnection(ctx context.Context, event string, details map[string]interface{}) {
	if !dl.config.Enabled {
		return
	}

	logCtx := dl.logger.WithContextValue(ctx)
	logCtx.Component = "database"
	logCtx.Operation = "connection"

	dl.logger.LogWebRTCEvent(logCtx, event, details)
}

// LogMigration logs database migration events
func (dl *DatabaseLogger) LogMigration(ctx context.Context, migration string, duration time.Duration, err error) {
	if !dl.config.Enabled {
		return
	}

	logCtx := dl.logger.WithContextValue(ctx)
	logCtx.Component = "database"
	logCtx.Operation = "migration"
	logCtx.Duration = duration

	entry := dl.logger.WithContext(logCtx).WithField("migration", migration)

	if err != nil {
		entry.WithError(err).Error("Database migration failed")
	} else {
		entry.Info("Database migration completed")
	}
}

// LogTransaction logs database transaction events
func (dl *DatabaseLogger) LogTransaction(ctx context.Context, event string, duration time.Duration, err error) {
	if !dl.config.Enabled {
		return
	}

	logCtx := dl.logger.WithContextValue(ctx)
	logCtx.Component = "database"
	logCtx.Operation = "transaction"
	logCtx.Duration = duration

	entry := dl.logger.WithContext(logCtx).WithField("transaction_event", event)

	if err != nil {
		entry.WithError(err).Error("Database transaction failed")
	} else {
		entry.Info("Database transaction " + event)
	}
}

// LogPoolStats logs database connection pool statistics
func (dl *DatabaseLogger) LogPoolStats(ctx context.Context, stats map[string]interface{}) {
	if !dl.config.Enabled {
		return
	}

	logCtx := dl.logger.WithContextValue(ctx)
	logCtx.Component = "database"
	logCtx.Operation = "pool_stats"

	entry := dl.logger.WithContext(logCtx)
	for key, value := range stats {
		entry = entry.WithField(key, value)
	}

	entry.Info("Database connection pool statistics")
}

// DefaultDatabaseLogConfig returns default configuration for database logging
func DefaultDatabaseLogConfig() DatabaseLogConfig {
	return DatabaseLogConfig{
		Enabled:           true,
		SlowThreshold:     200 * time.Millisecond,
		LogLevel:          "info",
		IgnoreErrNoRows:   true,
		IgnoreRecordNotFound: true,
	}
}

// ProductionDatabaseLogConfig returns production-optimized configuration
func ProductionDatabaseLogConfig() DatabaseLogConfig {
	return DatabaseLogConfig{
		Enabled:           true,
		SlowThreshold:     100 * time.Millisecond,
		LogLevel:          "warn",
		IgnoreErrNoRows:   true,
		IgnoreRecordNotFound: true,
	}
}

// DevelopmentDatabaseLogConfig returns development-optimized configuration
func DevelopmentDatabaseLogConfig() DatabaseLogConfig {
	return DatabaseLogConfig{
		Enabled:           true,
		SlowThreshold:     500 * time.Millisecond,
		LogLevel:          "debug",
		IgnoreErrNoRows:   false,
		IgnoreRecordNotFound: false,
	}
}