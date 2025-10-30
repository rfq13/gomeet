package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Server       ServerConfig
	Database     DatabaseConfig
	JWT          JWTConfig
	CORS         CORSConfig
	Logging      LoggingConfig
	Redis        RedisConfig
	RateLimit    RateLimitConfig
	TURN         TURNConfig
	LiveKit      LiveKitConfig
	WebRTC       WebRTCConfig
	DigitalOcean DigitalOceanConfig
}

type ServerConfig struct {
	Port   string
	GinMode string
}

type DatabaseConfig struct {
	Host                      string
	Port                      string
	User                      string
	Password                  string
	DBName                    string
	SSLMode                   string
	DisablePreparedStatements bool
}

type JWTConfig struct {
	Secret             string
	AccessTokenExpiry  time.Duration
	RefreshTokenExpiry time.Duration
}

type CORSConfig struct {
	AllowedOrigins []string
	DevelopmentOrigins []string
	ProductionOrigins []string
	MaxAge          int
	DebugMode       bool
	EnableMetrics   bool
}

type LoggingConfig struct {
	Level              string
	Format             string // "json" or "text"
	Output             string // "stdout", "file", or "both"
	FilePath           string
	MaxSize            int  // MB
	MaxBackups         int
	MaxAge             int  // days
	Compress           bool
	EnableConsoleColor bool
}

type RedisConfig struct {
	Host     string
	Port     string
	Password string
}


type RateLimitConfig struct {
	GeneralRequests    int
	GeneralWindow      time.Duration
	AuthRequests       int
	AuthWindow         time.Duration
	AuthenticatedRequests int
	AuthenticatedWindow   time.Duration
	Enabled            bool
}

type TURNConfig struct {
	Server         string
	Secret         string
	Enabled        bool
	AltServers     []string
	Port           int
	TLSPort        int
	MaxBandwidth   int
	TotalBandwidth int
}

type LiveKitConfig struct {
	APIKey      string
	APISecret   string
	ServerURL   string
	Enabled     bool
	RoomConfig  RoomConfig
	SFUConfig   SFUConfig
}

type WebRTCConfig struct {
	ICEServers        []ICEServerConfig
	CodecPreferences  []string
	Bandwidth         BandwidthConfig
	ConnectionTimeout time.Duration
	KeepAliveInterval time.Duration
}

type RoomConfig struct {
	MaxParticipants   int
	EmptyTimeout      time.Duration
	DepartureTimeout  time.Duration
	EnableRecording   bool
	AudioBitrate      int
	VideoBitrate      int
	ScreenShareBitrate int
}

type SFUConfig struct {
	Enabled            bool
	AdaptiveStream     bool
	Dynacast           bool
	VideoCaptureDefaults VideoCaptureConfig
	PublishDefaults    PublishConfig
}

type VideoCaptureConfig struct {
	Width  int
	Height int
	FPS    int
}

type PublishConfig struct {
	SimulcastLayers []SimulcastLayer
	AudioBitrate    int
	VideoBitrate    int
}

type SimulcastLayer struct {
	Quality string
	Width   int
	Height  int
	Bitrate int
}

type ICEServerConfig struct {
	URLs           []string
	Username       string
	Credential     string
	CredentialType string
}

type BandwidthConfig struct {
	Audio    int
	Video    int
	Screen   int
	MaxTotal int
}

type DigitalOceanConfig struct {
	APIToken string
}

func Load() *Config {
	return &Config{
		Server: ServerConfig{
			Port:   getEnv("PORT", "8080"),
			GinMode: getEnv("GIN_MODE", "debug"),
		},
		Database: DatabaseConfig{
			Host:                      getEnv("DB_HOST", "localhost"),
			Port:                      getEnv("DB_PORT", "5432"),
			User:                      getEnv("DB_USER", "gomeet"),
			Password:                  getEnv("DB_PASSWORD", ""),
			DBName:                    getEnv("DB_NAME", "gomeet_db"),
			SSLMode:                   getEnv("DB_SSLMODE", "disable"),
			DisablePreparedStatements: getBoolEnv("DB_DISABLE_PREPARED_STATEMENTS", true),
		},
		JWT: JWTConfig{
			Secret:             getEnv("JWT_SECRET", "your-secret-key"),
			AccessTokenExpiry:  getDurationEnv("JWT_ACCESS_TOKEN_EXPIRY", 15*time.Minute),
			RefreshTokenExpiry: getDurationEnv("JWT_REFRESH_TOKEN_EXPIRY", 7*24*time.Hour),
		},
		CORS: CORSConfig{
			DevelopmentOrigins: getStringSliceEnv("CORS_DEVELOPMENT_ORIGINS", []string{
				"http://localhost:3000",
				"http://localhost:5173",
				"http://localhost:5174",
				"http://localhost:5175",
				"http://127.0.0.1:3000",
				"http://127.0.0.1:5173",
				"http://127.0.0.1:5174",
				"http://127.0.0.1:5175",
			}),
			ProductionOrigins: getStringSliceEnv("CORS_PRODUCTION_ORIGINS", []string{
				"https://gomeet.filosofine.com",
				"https://api-gomeet.filosofine.com",
				"https://www.gomeet.filosofine.com",
			}),
			AllowedOrigins: getStringSliceEnv("ALLOWED_ORIGINS", []string{}), // Legacy support
			MaxAge:          getIntEnv("CORS_MAX_AGE", 86400), // 24 hours
			DebugMode:       getBoolEnv("CORS_DEBUG", false),
			EnableMetrics:   getBoolEnv("CORS_ENABLE_METRICS", true),
		},
		Logging: LoggingConfig{
			Level:              getEnv("LOG_LEVEL", "info"),
			Format:             getEnv("LOG_FORMAT", "text"),
			Output:             getEnv("LOG_OUTPUT", "stdout"),
			FilePath:           getEnv("LOG_FILE_PATH", "./logs/app.log"),
			MaxSize:            getIntEnv("LOG_MAX_SIZE", 100),
			MaxBackups:         getIntEnv("LOG_MAX_BACKUPS", 10),
			MaxAge:             getIntEnv("LOG_MAX_AGE", 30),
			Compress:           getBoolEnv("LOG_COMPRESS", true),
			EnableConsoleColor: getBoolEnv("LOG_CONSOLE_COLOR", true),
		},
		Redis: RedisConfig{
			Host:     getEnv("REDIS_HOST", "localhost"),
			Port:     getEnv("REDIS_PORT", "6379"),
			Password: getEnv("REDIS_PASSWORD", ""),
		},
		RateLimit: RateLimitConfig{
			GeneralRequests:      getIntEnv("RATE_LIMIT_GENERAL_REQUESTS", 100),
			GeneralWindow:        getDurationEnv("RATE_LIMIT_GENERAL_WINDOW", time.Minute),
			AuthRequests:         getIntEnv("RATE_LIMIT_AUTH_REQUESTS", 5),
			AuthWindow:           getDurationEnv("RATE_LIMIT_AUTH_WINDOW", time.Minute),
			AuthenticatedRequests: getIntEnv("RATE_LIMIT_AUTHENTICATED_REQUESTS", 1000),
			AuthenticatedWindow:   getDurationEnv("RATE_LIMIT_AUTHENTICATED_WINDOW", time.Minute),
			Enabled:              getBoolEnv("RATE_LIMIT_ENABLED", true),
		},
		TURN: TURNConfig{
			Server:         getEnv("TURN_SERVER", "127.0.0.1"),
			Secret:         getEnv("TURN_SECRET", "your-turn-secret-key"),
			Enabled:        getBoolEnv("TURN_ENABLED", true),
			AltServers:     getStringSliceEnv("TURN_ALT_SERVERS", []string{}),
			Port:           getIntEnv("TURN_PORT", 3478),
			TLSPort:        getIntEnv("TURN_TLS_PORT", 5349),
			MaxBandwidth:   getIntEnv("TURN_MAX_BANDWIDTH", 64000), // 64 kbps per user
			TotalBandwidth: getIntEnv("TURN_TOTAL_BANDWIDTH", 10000000), // 10 Mbps total
		},
		LiveKit:      loadLiveKitConfig(),
		WebRTC:       loadWebRTCConfig(),
		DigitalOcean: loadDigitalOceanConfig(),
	}
}

func loadLiveKitConfig() LiveKitConfig {
	return LiveKitConfig{
		APIKey:    getEnv("LIVEKIT_API_KEY", ""),
		APISecret: getEnv("LIVEKIT_API_SECRET", ""),
		ServerURL: getEnv("LIVEKIT_SERVER_URL", "wss://livekit.filosofine.com"),
		Enabled:   getBoolEnv("LIVEKIT_ENABLED", true),
		RoomConfig: RoomConfig{
			MaxParticipants:    getIntEnv("LIVEKIT_MAX_PARTICIPANTS", 50),
			EmptyTimeout:       getDurationEnv("LIVEKIT_EMPTY_TIMEOUT", 3*time.Minute),
			DepartureTimeout:   getDurationEnv("LIVEKIT_DEPARTURE_TIMEOUT", 10*time.Second),
			EnableRecording:    getBoolEnv("LIVEKIT_ENABLE_RECORDING", false),
			AudioBitrate:       getIntEnv("LIVEKIT_AUDIO_BITRATE", 64000), // 64 kbps
			VideoBitrate:       getIntEnv("LIVEKIT_VIDEO_BITRATE", 500000), // 500 kbps
			ScreenShareBitrate: getIntEnv("LIVEKIT_SCREEN_SHARE_BITRATE", 1200000), // 1.2 Mbps
		},
		SFUConfig: SFUConfig{
			Enabled:  getBoolEnv("LIVEKIT_SFU_ENABLED", true),
			AdaptiveStream: getBoolEnv("LIVEKIT_ADAPTIVE_STREAM", true),
			Dynacast: getBoolEnv("LIVEKIT_DYNACAST", true),
			VideoCaptureDefaults: VideoCaptureConfig{
				Width:  getIntEnv("LIVEKIT_VIDEO_WIDTH", 480),
				Height: getIntEnv("LIVEKIT_VIDEO_HEIGHT", 270),
				FPS:    getIntEnv("LIVEKIT_VIDEO_FPS", 30),
			},
			PublishDefaults: PublishConfig{
				SimulcastLayers: []SimulcastLayer{
					{
						Quality: "high",
						Width:   1280,
						Height:  720,
						Bitrate: 1000000, // 1 Mbps
					},
					{
						Quality: "medium",
						Width:   640,
						Height:  360,
						Bitrate: 500000, // 500 kbps
					},
					{
						Quality: "low",
						Width:   320,
						Height:  180,
						Bitrate: 200000, // 200 kbps
					},
				},
				AudioBitrate: getIntEnv("LIVEKIT_PUBLISH_AUDIO_BITRATE", 64000), // 64 kbps
				VideoBitrate: getIntEnv("LIVEKIT_PUBLISH_VIDEO_BITRATE", 500000), // 500 kbps
			},
		},
	}
}

func loadWebRTCConfig() WebRTCConfig {
	return WebRTCConfig{
		ICEServers: loadICEServers(),
		CodecPreferences: getStringSliceEnv("WEBRTC_CODEC_PREFERENCES", []string{
			"video/VP8",
			"video/VP9",
			"video/H264",
			"audio/opus",
			"audio/G722",
		}),
		Bandwidth: BandwidthConfig{
			Audio:    getIntEnv("WEBRTC_AUDIO_BANDWIDTH", 64000), // 64 kbps
			Video:    getIntEnv("WEBRTC_VIDEO_BANDWIDTH", 500000), // 500 kbps
			Screen:   getIntEnv("WEBRTC_SCREEN_BANDWIDTH", 1200000), // 1.2 Mbps
			MaxTotal: getIntEnv("WEBRTC_MAX_TOTAL_BANDWIDTH", 2000000), // 2 Mbps
		},
		ConnectionTimeout:  getDurationEnv("WEBRTC_CONNECTION_TIMEOUT", 30*time.Second),
		KeepAliveInterval:  getDurationEnv("WEBRTC_KEEP_ALIVE_INTERVAL", 25*time.Second),
	}
}

func loadICEServers() []ICEServerConfig {
	servers := []ICEServerConfig{}
	
	// STUN servers
	stunServers := getStringSliceEnv("WEBRTC_STUN_SERVERS", []string{
		"stun:stun.l.google.com:19302",
		"stun:stun1.l.google.com:19302",
		"stun:stun2.l.google.com:19302",
		"stun:stun.microsoft.com:3478",
	})
	
	for _, url := range stunServers {
		servers = append(servers, ICEServerConfig{
			URLs: []string{url},
		})
	}
	
	// TURN servers
	turnEnabled := getBoolEnv("TURN_ENABLED", true)
	if turnEnabled {
		turnServer := getEnv("TURN_SERVER", "127.0.0.1")
		turnPort := getIntEnv("TURN_PORT", 3478)
		turnUsername := getEnv("TURN_USERNAME", "")
		turnCredential := getEnv("TURN_CREDENTIAL", "")
		
		if turnServer != "" && turnUsername != "" && turnCredential != "" {
			servers = append(servers, ICEServerConfig{
				URLs: []string{
					"turn:" + turnServer + ":" + strconv.Itoa(turnPort),
					"turns:" + turnServer + ":" + strconv.Itoa(turnPort+1871), // 5349
				},
				Username:       turnUsername,
				Credential:     turnCredential,
				CredentialType: "password",
			})
		}
	}
	
	return servers
}

func loadDigitalOceanConfig() DigitalOceanConfig {
	return DigitalOceanConfig{
		APIToken: getEnv("DO_API_TOKEN", ""),
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

func getBoolEnv(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if parsed, err := strconv.ParseBool(value); err == nil {
			return parsed
		}
	}
	return defaultValue
}

func getIntEnv(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			return parsed
		}
	}
	return defaultValue
}