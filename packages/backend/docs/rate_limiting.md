# Rate Limiting Documentation

## Overview

GoMeet API implements rate limiting to prevent abuse and ensure fair usage of our services. Rate limiting is implemented using Redis as a storage backend with a sliding window algorithm.

## Rate Limits

### General Endpoints

- **Limit**: 100 requests per minute per IP address
- **Applied to**: All endpoints unless otherwise specified
- **Identifier**: Client IP address

### Authentication Endpoints

- **Limit**: 5 requests per minute per IP address
- **Applied to**: `/api/v1/auth/*` endpoints
- **Identifier**: Client IP address
- **Endpoints**:
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/refresh`
  - `POST /api/v1/auth/logout`

### Authenticated Endpoints

- **Limit**: 1000 requests per minute per user
- **Applied to**: All protected endpoints that require authentication
- **Identifier**: User ID (from JWT token)
- **Fallback**: If user ID is not available, falls back to IP-based limiting
- **Endpoints**:
  - `GET /api/v1/meetings/*`
  - `POST /api/v1/meetings/*`
  - `PUT /api/v1/meetings/*`
  - `DELETE /api/v1/meetings/*`
  - `GET /api/v1/users/*`
  - `GET /api/v1/webrtc/*`
  - `POST /api/v1/webrtc/*`
  - `GET /api/v1/feature-flags/*`
  - `POST /api/v1/feature-flags/*`

## Response Headers

When rate limiting is enabled, the following headers are included in API responses:

- `X-RateLimit-Limit`: The rate limit ceiling for the endpoint
- `X-RateLimit-Remaining`: The number of requests remaining in the current window
- `X-RateLimit-Reset`: The time when the rate limit window resets (Unix timestamp)

## Rate Limit Exceeded Response

When a rate limit is exceeded, the API returns a `429 Too Many Requests` response:

```json
{
  "error": "Rate limit exceeded",
  "message": {
    "en": "Too many requests. Please try again later.",
    "id": "Terlalu banyak permintaan. Silakan coba lagi nanti."
  },
  "retry_after": 45,
  "limit": 100,
  "window": "1m"
}
```

## Configuration

Rate limiting can be configured using the following environment variables:

| Variable                            | Default | Description                            |
| ----------------------------------- | ------- | -------------------------------------- |
| `RATE_LIMIT_ENABLED`                | `true`  | Enable/disable rate limiting           |
| `RATE_LIMIT_GENERAL_REQUESTS`       | `100`   | General endpoint request limit         |
| `RATE_LIMIT_GENERAL_WINDOW`         | `1m`    | General endpoint window duration       |
| `RATE_LIMIT_AUTH_REQUESTS`          | `5`     | Auth endpoint request limit            |
| `RATE_LIMIT_AUTH_WINDOW`            | `1m`    | Auth endpoint window duration          |
| `RATE_LIMIT_AUTHENTICATED_REQUESTS` | `1000`  | Authenticated endpoint request limit   |
| `RATE_LIMIT_AUTHENTICATED_WINDOW`   | `1m`    | Authenticated endpoint window duration |

## Implementation Details

### Sliding Window Algorithm

We use a sliding window algorithm implemented with Redis sorted sets:

1. Each request is stored in a Redis sorted set with the timestamp as the score
2. Old entries outside the current window are automatically removed
3. The current count is determined by counting entries within the window
4. This provides accurate rate limiting without fixed window boundaries

### Fail-Open Strategy

If Redis is unavailable or encounters errors, the rate limiter adopts a fail-open strategy:

- Requests are allowed to proceed
- A warning is logged
- This ensures service availability even when Redis is down

### IP Address Detection

The system uses the following priority for IP address detection:

1. `X-Forwarded-For` header (first IP in the list)
2. `X-Real-IP` header
3. `Gin's ClientIP()` method

This ensures proper IP detection behind load balancers and reverse proxies.

## Best Practices

### For API Consumers

1. **Respect Rate Limit Headers**: Always check the `X-RateLimit-*` headers
2. **Implement Exponential Backoff**: When receiving a 429 response, implement exponential backoff
3. **Cache Responses**: Cache non-changing responses to reduce API calls
4. **Use WebSockets**: For real-time features, use WebSocket connections instead of polling

### For Developers

1. **Monitor Rate Limit Events**: Set up alerts for frequent rate limit violations
2. **Adjust Limits Appropriately**: Configure limits based on your use case
3. **Test Rate Limiting**: Test your application against rate limits
4. **Handle 429 Responses Gracefully**: Ensure your application handles rate limit exceeded responses

## Monitoring and Logging

Rate limiting events are logged with the following information:

- Client IP address
- User ID (for authenticated requests)
- Rate limit type
- Request path and method
- Remaining requests
- User agent

These logs can be used for:

- Monitoring abuse patterns
- Identifying legitimate users hitting limits
- Adjusting rate limit configurations
- Security analysis

## Example Usage

### Making Rate-Limited Requests

```javascript
async function makeRequest(url, options = {}) {
  const response = await fetch(url, options);

  // Check rate limit headers
  const limit = response.headers.get("X-RateLimit-Limit");
  const remaining = response.headers.get("X-RateLimit-Remaining");
  const reset = response.headers.get("X-RateLimit-Reset");

  console.log(
    `Rate limit: ${remaining}/${limit} (resets at ${new Date(reset * 1000)})`
  );

  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    console.log(`Rate limited. Retry after ${retryAfter} seconds`);
    // Implement backoff logic here
  }

  return response;
}
```

### Handling Rate Limit Exceeded

```python
import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

def create_session_with_retries():
    session = requests.Session()

    retry_strategy = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[429],  # Retry on rate limit exceeded
        allowed_methods=["HEAD", "GET", "OPTIONS", "POST", "PUT", "DELETE"]
    )

    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("http://", adapter)
    session.mount("https://", adapter)

    return session
```

## Troubleshooting

### Common Issues

1. **Unexpected Rate Limits**: Check if your application is behind a proxy that might be changing the apparent IP address
2. **Rate Limits Not Working**: Ensure Redis is properly configured and accessible
3. **High Rate Limit Violations**: Consider if your application logic can be optimized to reduce API calls

### Debug Information

Enable debug logging to see detailed rate limiting information:

```bash
LOG_LEVEL=debug
```

This will log each rate limit check with detailed information about the request and limits.
