# Caching Strategy Documentation

## Overview

This document describes the comprehensive caching strategy implemented in the GoMeet backend to improve performance and reduce database load. The implementation uses Redis as the caching layer with a cache-aside pattern.

## Architecture

### Cache Repository Pattern

The caching implementation follows the repository pattern with a dedicated `CacheRepository` in the `internal/cache` package. This provides a clean abstraction for cache operations and ensures consistent caching behavior across all services.

### Cache-Aside Pattern

We implement the cache-aside pattern where:

1. Application code checks cache first
2. If cache miss, retrieve data from database
3. Populate cache with database result
4. Return data to client

## Cache Configuration

### TTL (Time To Live) Values

| Data Type         | TTL        | Rationale                                               |
| ----------------- | ---------- | ------------------------------------------------------- |
| User Profiles     | 30 minutes | User data changes infrequently, moderate cache duration |
| Meeting Details   | 15 minutes | Meeting data may change during active sessions          |
| Participant Lists | 10 minutes | Participant status changes frequently during meetings   |
| Feature Flags     | 5 minutes  | Feature flags may need quick updates for A/B testing    |
| Public User Data  | 30 minutes | Public user data is relatively static                   |
| Meeting Lists     | 5 minutes  | List data should be fresh for pagination                |

### Cache Key Patterns

```
user:profile:{userID}
meeting:details:{meetingID}
meeting:participants:{meetingID}
feature_flag:{flagName}
public_user:{sessionID}
meeting:list:{hostID}:page:{page}:limit:{limit}:search:{search}
meeting:joined:{userID}:page:{page}:limit:{limit}
meeting:upcoming:{hostID}:limit:{limit}
meeting:past:{hostID}:page:{page}:limit:{limit}
cache:stats
```

## Implementation Details

### Cache Repository Methods

#### Core Operations

- `Get(key, dest)` - Retrieve data from cache
- `Set(key, data, ttl)` - Store data in cache
- `Delete(key)` - Remove data from cache
- `DeleteByPattern(pattern)` - Remove multiple cache entries

#### Entity-Specific Operations

- `GetUserProfile(userID)` / `SetUserProfile(userID, data)`
- `GetMeetingDetails(meetingID)` / `SetMeetingDetails(meetingID, data)`
- `GetParticipantList(meetingID)` / `SetParticipantList(meetingID, data)`
- `GetFeatureFlag(flagName)` / `SetFeatureFlag(flagName, data)`
- `GetPublicUser(sessionID)` / `SetPublicUser(sessionID, data)`

#### Invalidation Operations

- `InvalidateUserProfile(userID)`
- `InvalidateMeetingDetails(meetingID)`
- `InvalidateParticipantList(meetingID)`
- `InvalidateFeatureFlag(flagName)`
- `InvalidatePublicUser(sessionID)`
- `InvalidateMeetingRelated(meetingID)` - Invalidates all meeting-related cache
- `InvalidateUserRelated(userID)` - Invalidates all user-related cache

### Structured Logging

All cache operations are logged with structured logging including:

- Operation type (get, set, delete)
- Cache key
- Hit/miss status
- Operation duration in milliseconds
- Error details (if any)

Example log entry:

```json
{
  "event": "get",
  "key": "user:profile:123e4567-e89b-12d3-a456-426614174000",
  "hit": true,
  "duration": 2,
  "level": "info",
  "msg": "Cache operation completed"
}
```

### Cache Statistics

The system maintains cache statistics including:

- Cache hits
- Cache misses
- Cache sets
- Cache deletes
- Cache errors
- Last updated timestamp

These statistics are stored in Redis under the `cache:stats` key and can be retrieved via the `GetCacheStats()` method.

## Service Integration

### Auth Service

- Caches user profiles for 30 minutes
- Invalidates cache on password updates and profile changes
- Uses cache for `GetUserByID()` operations

### Meeting Service

- Caches meeting details for 15 minutes
- Caches participant lists for 10 minutes
- Caches meeting list results for 5 minutes
- Invalidates relevant cache on meeting updates, participant joins/leaves

### Feature Flag Service

- Caches feature flags for 5 minutes
- Updates cache when flags are changed
- Falls back to default values when cache is unavailable

### Public User Service

- Caches public user data for 30 minutes
- Invalidates cache when public users are created or updated

## Error Handling

### Graceful Degradation

The caching system is designed to gracefully handle failures:

- If Redis is unavailable, operations fall back to database
- Cache errors are logged but don't fail the overall operation
- Cache misses are treated as normal flow, not errors

### Error Recovery

- Automatic cache invalidation on data changes
- Health check functionality to verify cache connectivity
- Statistics tracking to monitor cache performance

## Performance Considerations

### Memory Usage

- Cache entries include TTL information for automatic expiration
- Redis handles memory management with eviction policies
- Cache keys are designed to be efficient and avoid conflicts

### Network Latency

- Cache operations are significantly faster than database queries
- Redis connection pooling is handled by the Redis client
- Cache hits reduce database load and improve response times

### Scalability

- Cache can be scaled independently of the database
- Redis clustering can be implemented for high availability
- Cache invalidation is designed to work in distributed environments

## Monitoring and Maintenance

### Health Checks

The cache repository provides a `HealthCheck()` method that:

- Tests Redis connectivity
- Verifies read/write operations
- Cleans up test data

### Statistics Monitoring

Cache statistics can be monitored to:

- Track cache hit/miss ratios
- Identify cache performance issues
- Optimize TTL values based on usage patterns

### Cache Cleanup

- Automatic expiration based on TTL
- Manual cleanup methods for maintenance
- Pattern-based deletion for bulk operations

## Best Practices

### When to Use Cache

- Read-heavy operations
- Data that changes infrequently
- Expensive database queries
- User session data
- Configuration data

### When NOT to Use Cache

- Real-time data that must always be fresh
- Very large datasets that don't fit in memory
- Data with extremely high write frequency
- Sensitive data that shouldn't be persisted in cache

### Cache Key Design

- Use consistent naming conventions
- Include entity identifiers for uniqueness
- Avoid key collisions
- Use hierarchical structure for related data

### TTL Optimization

- Set TTL based on data change frequency
- Consider cache invalidation costs
- Balance memory usage with data freshness
- Monitor and adjust TTL values based on metrics

## Configuration

### Environment Variables

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Optional: Redis URL for cloud providers
REDIS_URL=redis://username:password@host:port
```

### Redis Setup

The caching system requires Redis server to be running:

- Local development: `docker run -d -p 6379:6379 redis:alpine`
- Production: Configure Redis cluster or managed service
- High availability: Configure Redis replication

## Troubleshooting

### Common Issues

1. **Redis Connection Failed**

   - Check Redis server status
   - Verify connection parameters
   - Check network connectivity

2. **Cache Misses Too High**

   - Review TTL values
   - Check cache invalidation logic
   - Monitor cache key patterns

3. **Memory Usage High**

   - Review TTL settings
   - Implement Redis eviction policies
   - Monitor cache size growth

4. **Stale Data**
   - Check invalidation logic
   - Review TTL values
   - Verify cache update operations

### Debugging

- Enable debug logging for cache operations
- Monitor cache statistics
- Use Redis CLI to inspect cache contents
- Check application logs for cache errors

## Future Enhancements

### Potential Improvements

1. **Cache Warming**

   - Pre-populate cache with frequently accessed data
   - Implement background cache warming jobs

2. **Multi-Level Caching**

   - Add in-memory cache for hot data
   - Implement cache hierarchy

3. **Cache Compression**

   - Compress large cache entries
   - Optimize memory usage

4. **Cache Analytics**

   - Detailed cache performance metrics
   - Automated TTL optimization

5. **Distributed Cache**
   - Redis clustering for scalability
   - Cache synchronization across instances

## Conclusion

The caching strategy implemented provides significant performance improvements while maintaining data consistency and system reliability. The cache-aside pattern with proper invalidation ensures that users get fast responses while data remains fresh and accurate.

Regular monitoring and optimization of cache settings will help maintain optimal performance as the application scales.
