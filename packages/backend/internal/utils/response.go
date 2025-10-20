package utils

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Message string      `json:"message,omitempty"`
}

type ErrorResponse struct {
	Success bool        `json:"success"`
	Error   ErrorDetail `json:"error"`
}

type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}

type PaginationMeta struct {
	Page       int `json:"page"`
	Limit      int `json:"limit"`
	Total      int `json:"total"`
	TotalPages int `json:"totalPages"`
}

// SuccessResponse sends a successful response
func SuccessResponse(c *gin.Context, statusCode int, data interface{}, message string) {
	response := APIResponse{
		Success: true,
		Data:    data,
		Message: message,
	}
	c.JSON(statusCode, response)
}

// SendErrorResponse sends an error response
func SendErrorResponse(c *gin.Context, statusCode int, errorCode, message string) {
	response := ErrorResponse{
		Success: false,
		Error: ErrorDetail{
			Code:    errorCode,
			Message: message,
		},
	}
	c.JSON(statusCode, response)
}

// ErrorResponseWithDetails sends an error response with additional details
func ErrorResponseWithDetails(c *gin.Context, statusCode int, errorCode, message, details string) {
	response := ErrorResponse{
		Success: false,
		Error: ErrorDetail{
			Code:    errorCode,
			Message: message,
			Details: details,
		},
	}
	c.JSON(statusCode, response)
}

// ValidationError sends a validation error response
func ValidationError(c *gin.Context, err error) {
	SendErrorResponse(c, http.StatusBadRequest, "VALIDATION_001", err.Error())
}

// NotFoundResponse sends a not found response
func NotFoundResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Resource not found"
	}
	SendErrorResponse(c, http.StatusNotFound, "NOT_FOUND", message)
}

// UnauthorizedResponse sends an unauthorized response
func UnauthorizedResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Unauthorized"
	}
	SendErrorResponse(c, http.StatusUnauthorized, "UNAUTHORIZED", message)
}

// ForbiddenResponse sends a forbidden response
func ForbiddenResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Forbidden"
	}
	SendErrorResponse(c, http.StatusForbidden, "FORBIDDEN", message)
}

// InternalServerErrorResponse sends an internal server error response
func InternalServerErrorResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Internal server error"
	}
	SendErrorResponse(c, http.StatusInternalServerError, "INTERNAL_ERROR", message)
}

// ConflictResponse sends a conflict response
func ConflictResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Conflict"
	}
	SendErrorResponse(c, http.StatusConflict, "CONFLICT", message)
}

// TooManyRequestsResponse sends a too many requests response
func TooManyRequestsResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Too many requests"
	}
	SendErrorResponse(c, http.StatusTooManyRequests, "RATE_LIMIT", message)
}

// GetUserID helper function to get user ID from context
func GetUserID(c *gin.Context) (string, bool) {
	userID, exists := c.Get("userID")
	if !exists {
		return "", false
	}
	
	// Handle both string and uuid.UUID types
	switch id := userID.(type) {
	case string:
		return id, true
	case uuid.UUID:
		return id.String(), true
	default:
		return "", false
	}
}

// GetUserIDUUID helper function to get user ID as UUID from context
func GetUserIDUUID(c *gin.Context) (uuid.UUID, bool) {
	userID, exists := c.Get("userID")
	if !exists {
		return uuid.Nil, false
	}
	
	// Handle both string and uuid.UUID types
	switch id := userID.(type) {
	case string:
		parsed, err := uuid.Parse(id)
		if err != nil {
			return uuid.Nil, false
		}
		return parsed, true
	case uuid.UUID:
		return id, true
	default:
		return uuid.Nil, false
	}
}