package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/filosofine/gomeet-backend/internal/config"
	"github.com/redis/go-redis/v9"
)

type RedisClient struct {
	client *redis.Client
	ctx    context.Context
}

func NewRedisClient(cfg *config.RedisConfig) *RedisClient {
	ctx := context.Background()
	
	// Create Redis client
	rdb := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%s", cfg.Host, cfg.Port),
		Password: cfg.Password,
		DB:       0, // Use default DB
	})

	// Test connection
	_, err := rdb.Ping(ctx).Result()
	if err != nil {
		log.Printf("Failed to connect to Redis: %v", err)
		// Don't panic, allow service to start with fallback
		return &RedisClient{
			client: nil,
			ctx:    ctx,
		}
	}

	log.Println("Successfully connected to Redis")
	return &RedisClient{
		client: rdb,
		ctx:    ctx,
	}
}

// IsConnected checks if Redis client is connected
func (r *RedisClient) IsConnected() bool {
	if r.client == nil {
		return false
	}
	
	_, err := r.client.Ping(r.ctx).Result()
	return err == nil
}

// Set stores a key-value pair with expiration
func (r *RedisClient) Set(key string, value interface{}, expiration time.Duration) error {
	if !r.IsConnected() {
		return fmt.Errorf("Redis not connected")
	}

	jsonValue, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("failed to marshal value: %w", err)
	}

	return r.client.Set(r.ctx, key, jsonValue, expiration).Err()
}

// Get retrieves a value by key
func (r *RedisClient) Get(key string, dest interface{}) error {
	if !r.IsConnected() {
		return fmt.Errorf("Redis not connected")
	}

	val, err := r.client.Get(r.ctx, key).Result()
	if err != nil {
		return err
	}

	return json.Unmarshal([]byte(val), dest)
}

// Delete removes a key
func (r *RedisClient) Delete(key string) error {
	if !r.IsConnected() {
		return fmt.Errorf("Redis not connected")
	}

	return r.client.Del(r.ctx, key).Err()
}

// Exists checks if a key exists
func (r *RedisClient) Exists(key string) (bool, error) {
	if !r.IsConnected() {
		return false, fmt.Errorf("Redis not connected")
	}

	count, err := r.client.Exists(r.ctx, key).Result()
	return count > 0, err
}

// Keys returns all keys matching a pattern
func (r *RedisClient) Keys(pattern string) ([]string, error) {
	if !r.IsConnected() {
		return nil, fmt.Errorf("Redis not connected")
	}

	return r.client.Keys(r.ctx, pattern).Result()
}

// HSet stores a field in a hash
func (r *RedisClient) HSet(key, field string, value interface{}) error {
	if !r.IsConnected() {
		return fmt.Errorf("Redis not connected")
	}

	jsonValue, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("failed to marshal value: %w", err)
	}

	return r.client.HSet(r.ctx, key, field, jsonValue).Err()
}

// HGet retrieves a field from a hash
func (r *RedisClient) HGet(key, field string, dest interface{}) error {
	if !r.IsConnected() {
		return fmt.Errorf("Redis not connected")
	}

	val, err := r.client.HGet(r.ctx, key, field).Result()
	if err != nil {
		return err
	}

	return json.Unmarshal([]byte(val), dest)
}

// HGetAll retrieves all fields from a hash
func (r *RedisClient) HGetAll(key string) (map[string]string, error) {
	if !r.IsConnected() {
		return nil, fmt.Errorf("Redis not connected")
	}

	return r.client.HGetAll(r.ctx, key).Result()
}

// HDel removes a field from a hash
func (r *RedisClient) HDel(key, field string) error {
	if !r.IsConnected() {
		return fmt.Errorf("Redis not connected")
	}

	return r.client.HDel(r.ctx, key, field).Err()
}

// Expire sets expiration for a key
func (r *RedisClient) Expire(key string, expiration time.Duration) error {
	if !r.IsConnected() {
		return fmt.Errorf("Redis not connected")
	}

	return r.client.Expire(r.ctx, key, expiration).Err()
}

// Close closes the Redis connection
func (r *RedisClient) Close() error {
	if r.client != nil {
		return r.client.Close()
	}
	return nil
}