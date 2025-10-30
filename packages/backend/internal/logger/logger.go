package logger

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"gopkg.in/natefinch/lumberjack.v2"
)

// LogLevel represents the logging level
type LogLevel string

const (
	DebugLevel LogLevel = "debug"
	InfoLevel  LogLevel = "info"
	WarnLevel  LogLevel = "warn"
	ErrorLevel LogLevel = "error"
	FatalLevel LogLevel = "fatal"
)

// LogConfig represents the logging configuration
type LogConfig struct {
	Level              LogLevel
	Format             string // "json" or "text"
	Output             string // "stdout", "file", or "both"
	FilePath           string
	MaxSize            int  // MB
	MaxBackups         int
	MaxAge             int  // days
	Compress           bool
	EnableConsoleColor bool
}

// Logger wraps logrus with additional functionality
type Logger struct {
	*logrus.Logger
	config LogConfig
}

// LogContext represents the logging context
type LogContext struct {
	RequestID   string
	UserID      string
	SessionID   string
	IP          string
	UserAgent   string
	Method      string
	Path        string
	StatusCode  int
	Duration    time.Duration
	Component   string
	Operation   string
	MeetingID   string
	PeerID      string
	Service     string
	Environment string
}

// NewLogger creates a new logger instance
func NewLogger(config LogConfig) *Logger {
	logger := logrus.New()

	// Set log level
	level, err := logrus.ParseLevel(string(config.Level))
	if err != nil {
		level = logrus.InfoLevel
	}
	logger.SetLevel(level)

	// Set formatter
	if config.Format == "json" {
		logger.SetFormatter(&logrus.JSONFormatter{
			TimestampFormat: time.RFC3339,
			FieldMap: logrus.FieldMap{
				logrus.FieldKeyTime:  "timestamp",
				logrus.FieldKeyLevel: "level",
				logrus.FieldKeyMsg:   "message",
				logrus.FieldKeyFunc:  "function",
				logrus.FieldKeyFile:  "file",
			},
		})
	} else {
		if config.EnableConsoleColor {
			logger.SetFormatter(&logrus.TextFormatter{
				FullTimestamp:   true,
				TimestampFormat: time.RFC3339,
				ForceColors:     true,
			})
		} else {
			logger.SetFormatter(&logrus.TextFormatter{
				FullTimestamp:   true,
				TimestampFormat: time.RFC3339,
				DisableColors:   true,
			})
		}
	}

	// Set output
	switch config.Output {
	case "file":
		if config.FilePath != "" {
			// Create directory if it doesn't exist
			dir := filepath.Dir(config.FilePath)
			if err := os.MkdirAll(dir, 0755); err != nil {
				logger.WithError(err).Error("Failed to create log directory")
			}

			// Setup log rotation with lumberjack
			logger.SetOutput(&lumberjack.Logger{
				Filename:   config.FilePath,
				MaxSize:    config.MaxSize,    // MB
				MaxBackups: config.MaxBackups,
				MaxAge:     config.MaxAge,     // days
				Compress:   config.Compress,
			})
		}
	case "both":
		if config.FilePath != "" {
			// Create directory if it doesn't exist
			dir := filepath.Dir(config.FilePath)
			if err := os.MkdirAll(dir, 0755); err != nil {
				logger.WithError(err).Error("Failed to create log directory")
			}

			// For both output, we'll use file output with rotation
			// In production, you might want to use a multi-writer
			logger.SetOutput(&lumberjack.Logger{
				Filename:   config.FilePath,
				MaxSize:    config.MaxSize,    // MB
				MaxBackups: config.MaxBackups,
				MaxAge:     config.MaxAge,     // days
				Compress:   config.Compress,
			})
		}
	default: // stdout
		logger.SetOutput(os.Stdout)
	}

	return &Logger{
		Logger: logger,
		config: config,
	}
}

// WithContext adds context to the log entry
func (l *Logger) WithContext(ctx LogContext) *logrus.Entry {
	fields := logrus.Fields{}

	if ctx.RequestID != "" {
		fields["request_id"] = ctx.RequestID
	}
	if ctx.UserID != "" {
		fields["user_id"] = ctx.UserID
	}
	if ctx.SessionID != "" {
		fields["session_id"] = ctx.SessionID
	}
	if ctx.IP != "" {
		fields["ip"] = ctx.IP
	}
	if ctx.UserAgent != "" {
		fields["user_agent"] = ctx.UserAgent
	}
	if ctx.Method != "" {
		fields["method"] = ctx.Method
	}
	if ctx.Path != "" {
		fields["path"] = ctx.Path
	}
	if ctx.StatusCode != 0 {
		fields["status_code"] = ctx.StatusCode
	}
	if ctx.Duration != 0 {
		fields["duration"] = ctx.Duration.String()
	}
	if ctx.Component != "" {
		fields["component"] = ctx.Component
	}
	if ctx.Operation != "" {
		fields["operation"] = ctx.Operation
	}
	if ctx.MeetingID != "" {
		fields["meeting_id"] = ctx.MeetingID
	}
	if ctx.PeerID != "" {
		fields["peer_id"] = ctx.PeerID
	}
	if ctx.Service != "" {
		fields["service"] = ctx.Service
	}
	if ctx.Environment != "" {
		fields["environment"] = ctx.Environment
	}

	return l.WithFields(fields)
}

// WithGinContext extracts context from Gin context
func (l *Logger) WithGinContext(c *gin.Context) LogContext {
	ctx := LogContext{}

	// Extract request ID
	if requestID, exists := c.Get("requestID"); exists {
		if id, ok := requestID.(string); ok {
			ctx.RequestID = id
		}
	}

	// Extract user ID
	if userID, exists := c.Get("userID"); exists {
		if id, ok := userID.(string); ok {
			ctx.UserID = id
		} else if uid, ok := userID.(uuid.UUID); ok {
			ctx.UserID = uid.String()
		}
	}

	// Extract request information
	ctx.IP = c.ClientIP()
	ctx.UserAgent = c.GetHeader("User-Agent")
	ctx.Method = c.Request.Method
	ctx.Path = c.Request.URL.Path

	// Get environment
	ctx.Environment = os.Getenv("ENVIRONMENT")
	if ctx.Environment == "" {
		ctx.Environment = "development"
	}

	return ctx
}

// WithContextValue extracts context from context.Context
func (l *Logger) WithContextValue(ctx context.Context) LogContext {
	logCtx := LogContext{}

	// Extract request ID
	if requestID := ctx.Value("requestID"); requestID != nil {
		if id, ok := requestID.(string); ok {
			logCtx.RequestID = id
		}
	}

	// Extract user ID
	if userID := ctx.Value("userID"); userID != nil {
		if id, ok := userID.(string); ok {
			logCtx.UserID = id
		} else if uid, ok := userID.(uuid.UUID); ok {
			logCtx.UserID = uid.String()
		}
	}

	// Extract session ID
	if sessionID := ctx.Value("sessionID"); sessionID != nil {
		if id, ok := sessionID.(string); ok {
			logCtx.SessionID = id
		}
	}

	// Get environment
	logCtx.Environment = os.Getenv("ENVIRONMENT")
	if logCtx.Environment == "" {
		logCtx.Environment = "development"
	}

	return logCtx
}

// LogAPIRequest logs API request details
func (l *Logger) LogAPIRequest(ctx LogContext, message string) {
	l.WithContext(ctx).Info(message)
}

// LogAPIResponse logs API response details
func (l *Logger) LogAPIResponse(ctx LogContext, message string) {
	l.WithContext(ctx).Info(message)
}

// LogDatabaseOperation logs database operations
func (l *Logger) LogDatabaseOperation(ctx LogContext, operation, table string, duration time.Duration) {
	ctx.Component = "database"
	ctx.Operation = operation
	ctx.Duration = duration

	l.WithContext(ctx).WithField("table", table).Info("Database operation completed")
}

// LogWebRTCEvent logs WebRTC events
func (l *Logger) LogWebRTCEvent(ctx LogContext, eventType string, details map[string]interface{}) {
	ctx.Component = "webrtc"
	ctx.Operation = eventType

	entry := l.WithContext(ctx)
	for key, value := range details {
		entry = entry.WithField(key, value)
	}

	entry.Info("WebRTC event")
}

// LogError logs errors with context
func (l *Logger) LogError(ctx LogContext, err error, message string) {
	l.WithContext(ctx).WithError(err).Error(message)
}

// LogPanic logs panics with context
func (l *Logger) LogPanic(ctx LogContext, err error, message string) {
	l.WithContext(ctx).WithError(err).Panic(message)
}

// LogPerformance logs performance metrics
func (l *Logger) LogPerformance(ctx LogContext, operation string, duration time.Duration, details map[string]interface{}) {
	ctx.Component = "performance"
	ctx.Operation = operation
	ctx.Duration = duration

	entry := l.WithContext(ctx)
	for key, value := range details {
		entry = entry.WithField(key, value)
	}

	entry.Info("Performance metric")
}

// LogSecurity logs security-related events
func (l *Logger) LogSecurity(ctx LogContext, eventType string, details map[string]interface{}) {
	ctx.Component = "security"
	ctx.Operation = eventType

	entry := l.WithContext(ctx)
	for key, value := range details {
		entry = entry.WithField(key, value)
	}

	entry.Warn("Security event")
}

// GetConfig returns the current logger configuration
func (l *Logger) GetConfig() LogConfig {
	return l.config
}

// UpdateConfig updates the logger configuration
func (l *Logger) UpdateConfig(config LogConfig) {
	l.config = config

	// Update log level
	level, err := logrus.ParseLevel(string(config.Level))
	if err == nil {
		l.SetLevel(level)
	}

	// Update formatter
	if config.Format == "json" {
		l.SetFormatter(&logrus.JSONFormatter{
			TimestampFormat: time.RFC3339,
		})
	} else {
		l.SetFormatter(&logrus.TextFormatter{
			FullTimestamp:   true,
			TimestampFormat: time.RFC3339,
			DisableColors:   !config.EnableConsoleColor,
		})
	}
}

// Default development configuration
func DefaultDevConfig() LogConfig {
	return LogConfig{
		Level:              InfoLevel,
		Format:             "text",
		Output:             "stdout",
		EnableConsoleColor: true,
	}
}

// Default production configuration
func DefaultProdConfig() LogConfig {
	return LogConfig{
		Level:              InfoLevel,
		Format:             "json",
		Output:             "both",
		FilePath:           "./logs/app.log",
		MaxSize:            100, // 100MB
		MaxBackups:         10,
		MaxAge:             30, // 30 days
		Compress:           true,
		EnableConsoleColor: false,
	}
}