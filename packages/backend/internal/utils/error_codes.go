package utils

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Error codes constants
const (
	// Validation errors
	VALIDATION_ERROR       = "VALIDATION_ERROR"
	INVALID_INPUT          = "INVALID_INPUT"
	VALIDATION_001         = "VALIDATION_001"
	VALIDATION_002         = "VALIDATION_002"

	// Authentication & Authorization errors
	UNAUTHORIZED           = "UNAUTHORIZED"
	FORBIDDEN              = "FORBIDDEN"
	AUTH_001               = "AUTH_001"
	AUTH_002               = "AUTH_002"
	AUTH_003               = "AUTH_003"
	AUTH_005               = "AUTH_005"
	AUTH_006               = "AUTH_006"

	// Not found errors
	NOT_FOUND              = "NOT_FOUND"
	USER_NOT_FOUND         = "USER_NOT_FOUND"
	MEETING_NOT_FOUND      = "MEETING_NOT_FOUND"

	// Conflict errors
	CONFLICT               = "CONFLICT"

	// Internal server errors
	INTERNAL_ERROR         = "INTERNAL_ERROR"
	DATABASE_ERROR         = "DATABASE_ERROR"
	NETWORK_ERROR          = "NETWORK_ERROR"

	// Rate limiting errors
	RATE_LIMIT_EXCEEDED    = "RATE_LIMIT_EXCEEDED"
	RATE_LIMIT             = "RATE_LIMIT"

	// Invalid ID errors
	INVALID_USER_ID        = "INVALID_USER_ID"
	INVALID_MEETING_ID     = "INVALID_MEETING_ID"
	INVALID_MESSAGE_ID     = "INVALID_MESSAGE_ID"
	INVALID_PUBLIC_USER_ID = "INVALID_PUBLIC_USER_ID"

	// Session errors
	SESSION_REQUIRED       = "SESSION_REQUIRED"

	// Request errors
	INVALID_REQUEST        = "INVALID_REQUEST"

	// Chat errors
	GET_MESSAGES_FAILED    = "GET_MESSAGES_FAILED"
	SEND_MESSAGE_FAILED    = "SEND_MESSAGE_FAILED"
	UPDATE_MESSAGE_FAILED  = "UPDATE_MESSAGE_FAILED"
	MARK_READ_FAILED       = "MARK_READ_FAILED"
	TOGGLE_REACTION_FAILED = "TOGGLE_REACTION_FAILED"
	GET_UNREAD_COUNT_FAILED = "GET_UNREAD_COUNT_FAILED"

	// WebRTC errors
	JOIN_FAILED            = "JOIN_FAILED"
	LEAVE_FAILED           = "LEAVE_FAILED"
	NOT_IN_MEETING         = "NOT_IN_MEETING"
	OFFER_FAILED           = "OFFER_FAILED"
	ANSWER_FAILED          = "ANSWER_FAILED"
	ICE_CANDIDATE_FAILED   = "ICE_CANDIDATE_FAILED"
	UPDATE_FAILED          = "UPDATE_FAILED"
	ROOM_FULL              = "ROOM_FULL"
	TOKEN_GENERATION_FAILED = "TOKEN_GENERATION_FAILED"

	// Feature flag errors
	FEATURE_FLAG_ERROR     = "FEATURE_FLAG_ERROR"
)

// ErrorInfo contains detailed information about an error
type ErrorInfo struct {
	Code       string
	Message    string
	Details    string
	HTTPStatus int
	Timestamp  time.Time
	Path       string
	Method     string
	UserID     string
	RequestID  string
}

// ErrorHandler provides structured error handling with logging
type ErrorHandler struct {
	logger *log.Logger
}

// NewErrorHandler creates a new error handler
func NewErrorHandler() *ErrorHandler {
	return &ErrorHandler{
		logger: log.New(log.Writer(), "[ERROR] ", log.LstdFlags|log.Lshortfile),
	}
}

// HandleError logs and sends structured error response
func (eh *ErrorHandler) HandleError(c *gin.Context, errorInfo ErrorInfo) {
	// Add request context to error info
	errorInfo.Path = c.Request.URL.Path
	errorInfo.Method = c.Request.Method
	errorInfo.Timestamp = time.Now()

	// Get user ID if available
	if userID, exists := c.Get("userID"); exists {
		if uid, ok := userID.(string); ok {
			errorInfo.UserID = uid
		}
	}

	// Get request ID if available
	if requestID := c.GetHeader("X-Request-ID"); requestID != "" {
		errorInfo.RequestID = requestID
	}

	// Log the error with structured information
	eh.logError(errorInfo)

	// Send error response
	response := ErrorResponse{
		Success: false,
		Error: ErrorDetail{
			Code:    errorInfo.Code,
			Message: errorInfo.Message,
			Details: errorInfo.Details,
		},
	}

	// Add request ID to response headers if available
	if errorInfo.RequestID != "" {
		c.Header("X-Request-ID", errorInfo.RequestID)
	}

	c.JSON(errorInfo.HTTPStatus, response)
}

// logError logs error information in a structured format
func (eh *ErrorHandler) logError(errorInfo ErrorInfo) {
	eh.logger.Printf(
		"Code: %s | Message: %s | Path: %s | Method: %s | UserID: %s | RequestID: %s | Details: %s",
		errorInfo.Code,
		errorInfo.Message,
		errorInfo.Path,
		errorInfo.Method,
		errorInfo.UserID,
		errorInfo.RequestID,
		errorInfo.Details,
	)
}

// Global error handler instance
var globalErrorHandler = NewErrorHandler()

// Structured error response functions with logging

// HandleValidationError handles validation errors with logging
func HandleValidationError(c *gin.Context, err error) {
	// Try to get custom validators if available
	if customValidators, exists := c.Get("customValidators"); exists {
		if cv, ok := customValidators.(*CustomValidators); ok {
			details := cv.GetValidationErrors(err)
			HandleValidationErrorResponse(c, details)
			return
		}
	}

	globalErrorHandler.HandleError(c, ErrorInfo{
		Code:       VALIDATION_ERROR,
		Message:    "Input validation failed",
		Details:    err.Error(),
		HTTPStatus: http.StatusBadRequest,
	})
}

// HandleValidationErrorResponse handles detailed validation errors with logging
func HandleValidationErrorResponse(c *gin.Context, details []ValidationErrorDetail) {
	detailsStr := ""
	for _, detail := range details {
		detailsStr += detail.Field + ": " + detail.Message + "; "
	}

	response := struct {
		Success bool                   `json:"success"`
		Error   ValidationErrorResponseStruct `json:"error"`
	}{
		Success: false,
		Error: ValidationErrorResponseStruct{
			Code:    VALIDATION_001,
			Message: "Input validation failed",
			Details: details,
		},
	}

	// Log the error
	globalErrorHandler.HandleError(c, ErrorInfo{
		Code:       VALIDATION_001,
		Message:    "Input validation failed",
		Details:    detailsStr,
		HTTPStatus: http.StatusBadRequest,
	})

	c.JSON(http.StatusBadRequest, response)
}

// HandleNotFoundResponse handles not found errors with logging
func HandleNotFoundResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Resource not found"
	}

	globalErrorHandler.HandleError(c, ErrorInfo{
		Code:       NOT_FOUND,
		Message:    message,
		HTTPStatus: http.StatusNotFound,
	})
}

// HandleUnauthorizedResponse handles unauthorized errors with logging
func HandleUnauthorizedResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Unauthorized"
	}

	globalErrorHandler.HandleError(c, ErrorInfo{
		Code:       UNAUTHORIZED,
		Message:    message,
		HTTPStatus: http.StatusUnauthorized,
	})
}

// HandleForbiddenResponse handles forbidden errors with logging
func HandleForbiddenResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Forbidden"
	}

	globalErrorHandler.HandleError(c, ErrorInfo{
		Code:       FORBIDDEN,
		Message:    message,
		HTTPStatus: http.StatusForbidden,
	})
}

// HandleInternalServerErrorResponse handles internal server errors with logging
func HandleInternalServerErrorResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Internal server error"
	}

	globalErrorHandler.HandleError(c, ErrorInfo{
		Code:       INTERNAL_ERROR,
		Message:    message,
		HTTPStatus: http.StatusInternalServerError,
	})
}

// HandleConflictResponse handles conflict errors with logging
func HandleConflictResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Conflict"
	}

	globalErrorHandler.HandleError(c, ErrorInfo{
		Code:       CONFLICT,
		Message:    message,
		HTTPStatus: http.StatusConflict,
	})
}

// HandleTooManyRequestsResponse handles rate limit errors with logging
func HandleTooManyRequestsResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Too many requests"
	}

	globalErrorHandler.HandleError(c, ErrorInfo{
		Code:       RATE_LIMIT_EXCEEDED,
		Message:    message,
		HTTPStatus: http.StatusTooManyRequests,
	})
}

// HandleDatabaseErrorResponse handles database errors with logging
func HandleDatabaseErrorResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Database operation failed"
	}

	globalErrorHandler.HandleError(c, ErrorInfo{
		Code:       DATABASE_ERROR,
		Message:    message,
		HTTPStatus: http.StatusInternalServerError,
	})
}

// HandleNetworkErrorResponse handles network errors with logging
func HandleNetworkErrorResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Network operation failed"
	}

	globalErrorHandler.HandleError(c, ErrorInfo{
		Code:       NETWORK_ERROR,
		Message:    message,
		HTTPStatus: http.StatusServiceUnavailable,
	})
}

// HandleInvalidInputResponse handles invalid input errors with logging
func HandleInvalidInputResponse(c *gin.Context, message string) {
	if message == "" {
		message = "Invalid input provided"
	}

	globalErrorHandler.HandleError(c, ErrorInfo{
		Code:       INVALID_INPUT,
		Message:    message,
		HTTPStatus: http.StatusBadRequest,
	})
}

// HandleSendErrorResponse remains for backward compatibility but now includes logging
func HandleSendErrorResponse(c *gin.Context, statusCode int, errorCode, message string) {
	globalErrorHandler.HandleError(c, ErrorInfo{
		Code:       errorCode,
		Message:    message,
		HTTPStatus: statusCode,
	})
}

// HandleErrorResponseWithDetails remains for backward compatibility but now includes logging
func HandleErrorResponseWithDetails(c *gin.Context, statusCode int, errorCode, message, details string) {
	globalErrorHandler.HandleError(c, ErrorInfo{
		Code:       errorCode,
		Message:    message,
		Details:    details,
		HTTPStatus: statusCode,
	})
}

// Backward compatibility functions - these will be deprecated
func ValidationError(c *gin.Context, err error) {
	HandleValidationError(c, err)
}

func ValidationErrorResponse(c *gin.Context, details []ValidationErrorDetail) {
	HandleValidationErrorResponse(c, details)
}

func NotFoundResponse(c *gin.Context, message string) {
	HandleNotFoundResponse(c, message)
}

func UnauthorizedResponse(c *gin.Context, message string) {
	HandleUnauthorizedResponse(c, message)
}

func ForbiddenResponse(c *gin.Context, message string) {
	HandleForbiddenResponse(c, message)
}

func InternalServerErrorResponse(c *gin.Context, message string) {
	HandleInternalServerErrorResponse(c, message)
}

func ConflictResponse(c *gin.Context, message string) {
	HandleConflictResponse(c, message)
}

func TooManyRequestsResponse(c *gin.Context, message string) {
	HandleTooManyRequestsResponse(c, message)
}

func DatabaseErrorResponse(c *gin.Context, message string) {
	HandleDatabaseErrorResponse(c, message)
}

func NetworkErrorResponse(c *gin.Context, message string) {
	HandleNetworkErrorResponse(c, message)
}

func InvalidInputResponse(c *gin.Context, message string) {
	HandleInvalidInputResponse(c, message)
}

func SendErrorResponse(c *gin.Context, statusCode int, errorCode, message string) {
	HandleSendErrorResponse(c, statusCode, errorCode, message)
}

func ErrorResponseWithDetails(c *gin.Context, statusCode int, errorCode, message, details string) {
	HandleErrorResponseWithDetails(c, statusCode, errorCode, message, details)
}