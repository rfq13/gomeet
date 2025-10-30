package utils

import (
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

// ValidationErrorResponseStruct represents the validation error response structure
type ValidationErrorResponseStruct struct {
	Code    string                 `json:"code"`
	Message string                 `json:"message"`
	Details []ValidationErrorDetail `json:"details"`
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