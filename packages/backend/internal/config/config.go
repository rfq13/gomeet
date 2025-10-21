package config

import (
	"os"
	"strings"
	"time"
)

type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	JWT      JWTConfig
	CORS     CORSConfig
	Logging  LoggingConfig
	Redis    RedisConfig
	TURN     TURNConfig
}

type ServerConfig struct {
	Port   string
	GinMode string
}

type DatabaseConfig struct {
	Host     string
	Port     string
	User     string
	Password string
	DBName   string
	SSLMode  string
}

type JWTConfig struct {
	Secret             string
	AccessTokenExpiry  time.Duration
	RefreshTokenExpiry time.Duration
}

type CORSConfig struct {
	AllowedOrigins []string
}

type LoggingConfig struct {
	Level string
}

type RedisConfig struct {
	Host     string
	Port     string
	Password string
}


type TURNConfig struct {
	Server string
	Secret string
}

func Load() *Config {
	return &Config{
		Server: ServerConfig{
			Port:   getEnv("PORT", "8080"),
			GinMode: getEnv("GIN_MODE", "debug"),
		},
		Database: DatabaseConfig{
			Host:     getEnv("DB_HOST", "localhost"),
			Port:     getEnv("DB_PORT", "5432"),
			User:     getEnv("DB_USER", "gomeet"),
			Password: getEnv("DB_PASSWORD", ""),
			DBName:   getEnv("DB_NAME", "gomeet_db"),
			SSLMode:  getEnv("DB_SSLMODE", "disable"),
		},
		JWT: JWTConfig{
			Secret:             getEnv("JWT_SECRET", "your-secret-key"),
			AccessTokenExpiry:  getDurationEnv("JWT_ACCESS_TOKEN_EXPIRY", 15*time.Minute),
			RefreshTokenExpiry: getDurationEnv("JWT_REFRESH_TOKEN_EXPIRY", 7*24*time.Hour),
		},
		CORS: CORSConfig{
			AllowedOrigins: getStringSliceEnv("ALLOWED_ORIGINS", []string{"http://localhost:3000"}),
		},
		Logging: LoggingConfig{
			Level: getEnv("LOG_LEVEL", "info"),
		},
		Redis: RedisConfig{
			Host:     getEnv("REDIS_HOST", "localhost"),
			Port:     getEnv("REDIS_PORT", "6379"),
			Password: getEnv("REDIS_PASSWORD", ""),
		},
		TURN: TURNConfig{
			Server: getEnv("TURN_SERVER", "127.0.0.1"),
			Secret: getEnv("TURN_SECRET", "your-turn-secret-key"),
		},
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getDurationEnv(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if duration, err := time.ParseDuration(value); err == nil {
			return duration
		}
	}
	return defaultValue
}

func getStringSliceEnv(key string, defaultValue []string) []string {
	if value := os.Getenv(key); value != "" {
		// Split by comma and trim spaces
		origins := []string{}
		for _, origin := range strings.Split(value, ",") {
			trimmed := strings.TrimSpace(origin)
			if trimmed != "" {
				origins = append(origins, trimmed)
			}
		}
		return origins
	}
	return defaultValue
}