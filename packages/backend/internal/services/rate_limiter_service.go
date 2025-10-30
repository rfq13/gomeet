package services

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/filosofine/gomeet-backend/internal/config"
	"github.com/redis/go-redis/v9"
)

type RateLimiterService struct {
	client *redis.Client
	config config.RateLimitConfig
	ctx    context.Context
}

type RateLimitResult struct {
	Allowed     bool
	Remaining   int
	ResetTime   time.Time
	TotalLimit  int
}

// NewRateLimiterService creates a new rate limiter service
func NewRateLimiterService(redisClient *redis.Client, cfg config.RateLimitConfig) *RateLimiterService {
	return &RateLimiterService{
		client: redisClient,
		config: cfg,
		ctx:    context.Background(),
	}
}

// IsEnabled returns whether rate limiting is enabled
func (r *RateLimiterService) IsEnabled() bool {
	return r.config.Enabled && r.client != nil
}

// CheckRateLimit checks if the request is allowed based on the key and limits
func (r *RateLimiterService) CheckRateLimit(key string, limit int, window time.Duration) (*RateLimitResult, error) {
	if !r.IsEnabled() {
		return &RateLimitResult{
			Allowed:    true,
			Remaining:  limit,
			TotalLimit: limit,
		}, nil
	}

	// Use sliding window approach with Redis
	now := time.Now()
	windowStart := now.Add(-window)
	
	// Remove old entries outside the window
	pipe := r.client.Pipeline()
	pipe.ZRemRangeByScore(r.ctx, key, "0", fmt.Sprintf("%d", windowStart.UnixMilli()))
	
	// Count current requests in window
	currentCountCmd := pipe.ZCard(r.ctx, key)
	
	// Add current request
	pipe.ZAdd(r.ctx, key, redis.Z{
		Score:  float64(now.UnixMilli()),
		Member: now.UnixNano(),
	})
	
	// Set expiration to window duration
	pipe.Expire(r.ctx, key, window)
	
	// Execute pipeline
	_, err := pipe.Exec(r.ctx)
	if err != nil {
		log.Printf("Error executing rate limit pipeline: %v", err)
		// If Redis fails, allow the request (fail open)
		return &RateLimitResult{
			Allowed:    true,
			Remaining:  limit,
			TotalLimit: limit,
		}, nil
	}
	
	currentCount, err := currentCountCmd.Result()
	if err != nil {
		log.Printf("Error getting current count: %v", err)
		return &RateLimitResult{
			Allowed:    true,
			Remaining:  limit,
			TotalLimit: limit,
		}, nil
	}
	
	remaining := limit - int(currentCount)
	allowed := currentCount < int64(limit)
	
	// Calculate reset time (when the oldest request will expire)
	resetTime := now.Add(window)
	
	return &RateLimitResult{
		Allowed:    allowed,
		Remaining:  remaining,
		ResetTime:  resetTime,
		TotalLimit: limit,
	}, nil
}

// CheckGeneralRateLimit checks rate limit for general endpoints (IP-based)
func (r *RateLimiterService) CheckGeneralRateLimit(ip string) (*RateLimitResult, error) {
	key := fmt.Sprintf("rate_limit:general:%s", ip)
	return r.CheckRateLimit(key, r.config.GeneralRequests, r.config.GeneralWindow)
}

// CheckAuthRateLimit checks rate limit for auth endpoints (IP-based, stricter)
func (r *RateLimiterService) CheckAuthRateLimit(ip string) (*RateLimitResult, error) {
	key := fmt.Sprintf("rate_limit:auth:%s", ip)
	return r.CheckRateLimit(key, r.config.AuthRequests, r.config.AuthWindow)
}

// CheckAuthenticatedRateLimit checks rate limit for authenticated endpoints (user-based)
func (r *RateLimiterService) CheckAuthenticatedRateLimit(userID string) (*RateLimitResult, error) {
	key := fmt.Sprintf("rate_limit:authenticated:%s", userID)
	return r.CheckRateLimit(key, r.config.AuthenticatedRequests, r.config.AuthenticatedWindow)
}

// CleanupExpiredKeys removes expired rate limit keys (optional maintenance)
func (r *RateLimiterService) CleanupExpiredKeys() error {
	if !r.IsEnabled() {
		return nil
	}
	
	pattern := "rate_limit:*"
	keys, err := r.client.Keys(r.ctx, pattern).Result()
	if err != nil {
		return fmt.Errorf("error getting keys for cleanup: %w", err)
	}
	
	for _, key := range keys {
		ttl := r.client.TTL(r.ctx, key).Val()
		if ttl == -1 { // No expiration set
			// Set default expiration based on key type
			if len(key) > 20 {
				r.client.Expire(r.ctx, key, time.Hour)
			}
		}
	}
	
	return nil
}