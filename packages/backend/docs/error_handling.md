# Error Handling Documentation

## Overview

This document describes the structured error handling implementation in the GoMeet backend API. The error handling system provides consistent error responses with proper logging and error codes for better debugging and client-side error handling.

## Error Response Format

All error responses follow this consistent format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": "Additional error details (optional)"
  }
}
```

## Error Codes

### Validation Errors

| Code               | HTTP Status | Description                         |
| ------------------ | ----------- | ----------------------------------- |
| `VALIDATION_ERROR` | 400         | General validation error            |
| `INVALID_INPUT`    | 400         | Invalid input provided              |
| `VALIDATION_001`   | 400         | Input validation failed             |
| `VALIDATION_002`   | 400         | At least one field must be provided |

### Authentication & Authorization Errors

| Code           | HTTP Status | Description                   |
| -------------- | ----------- | ----------------------------- |
| `UNAUTHORIZED` | 401         | User not authenticated        |
| `FORBIDDEN`    | 403         | Access forbidden              |
| `AUTH_001`     | 401         | Authentication failed         |
| `AUTH_002`     | 404         | User not found                |
| `AUTH_003`     | 409         | User already exists           |
| `AUTH_005`     | 401         | Invalid or expired token      |
| `AUTH_006`     | 400         | Current password is incorrect |

### Not Found Errors

| Code                | HTTP Status | Description        |
| ------------------- | ----------- | ------------------ |
| `NOT_FOUND`         | 404         | Resource not found |
| `USER_NOT_FOUND`    | 404         | User not found     |
| `MEETING_NOT_FOUND` | 404         | Meeting not found  |

### Conflict Errors

| Code       | HTTP Status | Description       |
| ---------- | ----------- | ----------------- |
| `CONFLICT` | 409         | Resource conflict |

### Internal Server Errors

| Code             | HTTP Status | Description               |
| ---------------- | ----------- | ------------------------- |
| `INTERNAL_ERROR` | 500         | Internal server error     |
| `DATABASE_ERROR` | 500         | Database operation failed |
| `NETWORK_ERROR`  | 503         | Network operation failed  |

### Rate Limiting Errors

| Code                  | HTTP Status | Description         |
| --------------------- | ----------- | ------------------- |
| `RATE_LIMIT_EXCEEDED` | 429         | Too many requests   |
| `RATE_LIMIT`          | 429         | Rate limit exceeded |

### Invalid ID Errors

| Code                     | HTTP Status | Description                   |
| ------------------------ | ----------- | ----------------------------- |
| `INVALID_USER_ID`        | 400         | Invalid user ID format        |
| `INVALID_MEETING_ID`     | 400         | Invalid meeting ID format     |
| `INVALID_MESSAGE_ID`     | 400         | Invalid message ID format     |
| `INVALID_PUBLIC_USER_ID` | 400         | Invalid public user ID format |

### Session Errors

| Code               | HTTP Status | Description                          |
| ------------------ | ----------- | ------------------------------------ |
| `SESSION_REQUIRED` | 400         | Session ID required for public users |

### Request Errors

| Code              | HTTP Status | Description            |
| ----------------- | ----------- | ---------------------- |
| `INVALID_REQUEST` | 400         | Invalid request format |

### Chat Errors

| Code                      | HTTP Status | Description                    |
| ------------------------- | ----------- | ------------------------------ |
| `GET_MESSAGES_FAILED`     | 500         | Failed to get messages         |
| `SEND_MESSAGE_FAILED`     | 500         | Failed to send message         |
| `UPDATE_MESSAGE_FAILED`   | 500         | Failed to update message       |
| `MARK_READ_FAILED`        | 500         | Failed to mark message as read |
| `TOGGLE_REACTION_FAILED`  | 500         | Failed to toggle reaction      |
| `GET_UNREAD_COUNT_FAILED` | 500         | Failed to get unread count     |

### WebRTC Errors

| Code                      | HTTP Status | Description                       |
| ------------------------- | ----------- | --------------------------------- |
| `JOIN_FAILED`             | 500         | Failed to join meeting            |
| `LEAVE_FAILED`            | 400         | Failed to leave meeting           |
| `NOT_IN_MEETING`          | 400         | User not in meeting               |
| `OFFER_FAILED`            | 400         | Failed to send WebRTC offer       |
| `ANSWER_FAILED`           | 400         | Failed to send WebRTC answer      |
| `ICE_CANDIDATE_FAILED`    | 400         | Failed to send ICE candidate      |
| `UPDATE_FAILED`           | 400         | Failed to update peer state       |
| `ROOM_FULL`               | 403         | Room has reached maximum capacity |
| `TOKEN_GENERATION_FAILED` | 500         | Failed to generate LiveKit token  |

### Feature Flag Errors

| Code                 | HTTP Status | Description                   |
| -------------------- | ----------- | ----------------------------- |
| `FEATURE_FLAG_ERROR` | 500         | Feature flag operation failed |

## Error Handling Functions

### Structured Error Handling Functions

The following functions are available for structured error handling with logging:

- `HandleValidationError(c *gin.Context, err error)`
- `HandleValidationErrorResponse(c *gin.Context, details []ValidationErrorDetail)`
- `HandleNotFoundResponse(c *gin.Context, message string)`
- `HandleUnauthorizedResponse(c *gin.Context, message string)`
- `HandleForbiddenResponse(c *gin.Context, message string)`
- `HandleInternalServerErrorResponse(c *gin.Context, message string)`
- `HandleConflictResponse(c *gin.Context, message string)`
- `HandleTooManyRequestsResponse(c *gin.Context, message string)`
- `HandleDatabaseErrorResponse(c *gin.Context, message string)`
- `HandleNetworkErrorResponse(c *gin.Context, message string)`
- `HandleInvalidInputResponse(c *gin.Context, message string)`
- `HandleSendErrorResponse(c *gin.Context, statusCode int, errorCode, message string)`
- `HandleErrorResponseWithDetails(c *gin.Context, statusCode int, errorCode, message, details string)`

### Backward Compatibility Functions

For backward compatibility, the following functions are still available but will log errors using the new structured system:

- `ValidationError(c *gin.Context, err error)`
- `ValidationErrorResponse(c *gin.Context, details []ValidationErrorDetail)`
- `NotFoundResponse(c *gin.Context, message string)`
- `UnauthorizedResponse(c *gin.Context, message string)`
- `ForbiddenResponse(c *gin.Context, message string)`
- `InternalServerErrorResponse(c *gin.Context, message string)`
- `ConflictResponse(c *gin.Context, message string)`
- `TooManyRequestsResponse(c *gin.Context, message string)`
- `DatabaseErrorResponse(c *gin.Context, message string)`
- `NetworkErrorResponse(c *gin.Context, message string)`
- `InvalidInputResponse(c *gin.Context, message string)`
- `SendErrorResponse(c *gin.Context, statusCode int, errorCode, message string)`
- `ErrorResponseWithDetails(c *gin.Context, statusCode int, errorCode, message, details string)`

## Logging

All errors are automatically logged with structured information including:

- Error code
- Error message
- Request path
- HTTP method
- User ID (if available)
- Request ID (if available)
- Error details
- Timestamp

Log format:

```
[ERROR] Code: AUTH_001 | Message: Authentication failed | Path: /api/auth/login | Method: POST | UserID: 123e4567-e89b-12d3-a456-426614174000 | RequestID: req-123 | Details: Invalid password
```

## Request ID Tracking

Clients can include a `X-Request-ID` header to track requests across the system. This ID will be:

1. Logged with any errors that occur
2. Returned in the response headers

## Usage Examples

### Basic Error Handling

```go
func (c *Controller) SomeHandler(ctx *gin.Context) {
    // Validation error
    if err := validateInput(input); err != nil {
        utils.HandleValidationError(ctx, err)
        return
    }

    // Not found error
    resource, err := getResource(id)
    if err != nil {
        utils.HandleNotFoundResponse(ctx, "Resource not found")
        return
    }

    // Custom error with details
    if err := someOperation(); err != nil {
        utils.HandleSendErrorResponse(ctx, http.StatusInternalServerError,
            utils.DATABASE_ERROR, "Database operation failed")
        return
    }

    utils.SuccessResponse(ctx, http.StatusOK, resource, "Operation successful")
}
```

### Error with Additional Details

```go
if err := someOperation(); err != nil {
    utils.HandleErrorResponseWithDetails(ctx, http.StatusBadRequest,
        utils.INVALID_INPUT, "Invalid input format",
        fmt.Sprintf("Field '%s' has invalid value: %v", fieldName, fieldValue))
    return
}
```

## Migration Guide

When migrating existing code to use the new structured error handling:

1. Replace `utils.ValidationError` with `utils.HandleValidationError`
2. Replace `utils.SendErrorResponse` with `utils.HandleSendErrorResponse`
3. Use constants from `utils` package for error codes instead of hardcoded strings
4. Ensure all error responses provide meaningful messages

### Before

```go
utils.SendErrorResponse(ctx, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid input")
```

### After

```go
utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.VALIDATION_ERROR, "Invalid input")
```

## Best Practices

1. **Use specific error codes**: Always use the most specific error code for the situation
2. **Provide clear messages**: Error messages should be clear and actionable
3. **Include relevant details**: Add additional context when helpful for debugging
4. **Log consistently**: All error responses are automatically logged, no need for additional logging
5. **Handle validation errors**: Use structured validation error responses for form validation
6. **Use request IDs**: Include request IDs for better traceability

## Client-Side Handling

Clients should handle errors based on the error code rather than just the HTTP status:

```javascript
// Example client-side error handling
const response = await fetch("/api/auth/login", {
  /* ... */
});
const data = await response.json();

if (!data.success) {
  switch (data.error.code) {
    case "AUTH_001":
      // Handle authentication failure
      break;
    case "VALIDATION_ERROR":
      // Handle validation errors
      break;
    case "RATE_LIMIT_EXCEEDED":
      // Handle rate limiting
      break;
    default:
      // Handle generic errors
      break;
  }
}
```
