package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"

	"github.com/filosofine/gomeet-backend/internal/models"
	"github.com/filosofine/gomeet-backend/internal/services"
	"github.com/filosofine/gomeet-backend/internal/utils"
)

type AuthController struct {
	authService *services.AuthService
	validator   *validator.Validate
	customValidators *utils.CustomValidators
}

func NewAuthController(authService *services.AuthService) *AuthController {
	customValidators := utils.NewCustomValidators()
	return &AuthController{
		authService: authService,
		validator:   customValidators.GetValidator(),
		customValidators: customValidators,
	}
}

// Register handles user registration
// @Summary Register a new user
// @Description Register a new user with username, email, and password
// @Tags auth
// @Accept json
// @Produce json
// @Param request body models.RegisterRequest true "Registration request"
// @Success 201 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 409 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/auth/register [post]
func (c *AuthController) Register(ctx *gin.Context) {
	var req models.RegisterRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	response, err := c.authService.Register(&req)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusConflict, utils.AUTH_003, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusCreated, response, "User registered successfully")
}

// Login handles user login
// @Summary Login user
// @Description Authenticate user with email and password
// @Tags auth
// @Accept json
// @Produce json
// @Param request body models.LoginRequest true "Login request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/auth/login [post]
func (c *AuthController) Login(ctx *gin.Context) {
	var req models.LoginRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	response, err := c.authService.Login(&req)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusUnauthorized, utils.AUTH_001, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, response, "Login successful")
}

// RefreshToken handles token refresh
// @Summary Refresh access token
// @Description Refresh access token using refresh token
// @Tags auth
// @Accept json
// @Produce json
// @Param request body map[string]string true "Refresh token"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Router /api/auth/refresh [post]
func (c *AuthController) RefreshToken(ctx *gin.Context) {
	var req struct {
		RefreshToken string `json:"refreshToken" validate:"required"`
	}

	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	response, err := c.authService.RefreshToken(req.RefreshToken)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusUnauthorized, utils.AUTH_005, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, response, "Token refreshed successfully")
}

// GetMe handles getting current user info
// @Summary Get current user
// @Description Get current authenticated user information
// @Tags auth
// @Produce json
// @Security BearerAuth
// @Success 200 {object} utils.APIResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 404 {object} utils.ErrorResponse
// @Router /api/auth/me [get]
func (c *AuthController) GetMe(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.HandleUnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	user, err := c.authService.GetUserByID(userID)
	if err != nil {
		utils.HandleSendErrorResponse(ctx, http.StatusNotFound, utils.AUTH_002, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, gin.H{"user": user.ToResponse()}, "User retrieved successfully")
}

// UpdatePassword handles password update
// @Summary Update password
// @Description Update authenticated user's password
// @Tags auth
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body models.UpdatePasswordRequest true "Password update request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/auth/update-password [put]
func (c *AuthController) UpdatePassword(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.HandleUnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	var req models.UpdatePasswordRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.authService.UpdatePassword(userID, &req); err != nil {
		if err.Error() == "user not found" {
			utils.HandleSendErrorResponse(ctx, http.StatusNotFound, utils.AUTH_002, err.Error())
			return
		}
		if err.Error() == "current password is incorrect" {
			utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.AUTH_006, err.Error())
			return
		}
		utils.HandleInternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, nil, "Password updated successfully")
}

// UpdateProfile handles profile update
// @Summary Update profile
// @Description Update authenticated user's profile information
// @Tags auth
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body map[string]string true "Profile update request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Failure 401 {object} utils.ErrorResponse
// @Failure 500 {object} utils.ErrorResponse
// @Router /api/auth/update-profile [put]
func (c *AuthController) UpdateProfile(ctx *gin.Context) {
	userID, exists := utils.GetUserID(ctx)
	if !exists {
		utils.HandleUnauthorizedResponse(ctx, "User not authenticated")
		return
	}

	// Set custom validators in context for detailed error handling
	ctx.Set("customValidators", c.customValidators)

	var req struct {
		Username string `json:"username,omitempty" validate:"omitempty,username"`
		Email    string `json:"email,omitempty" validate:"omitempty,email_strong"`
	}

	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	// Validate that at least one field is provided
	if req.Username == "" && req.Email == "" {
		utils.HandleSendErrorResponse(ctx, http.StatusBadRequest, utils.VALIDATION_002, "At least one field (username or email) must be provided")
		return
	}

	response, err := c.authService.UpdateProfile(userID, req.Username, req.Email)
	if err != nil {
		if err.Error() == "user not found" {
			utils.HandleSendErrorResponse(ctx, http.StatusNotFound, utils.AUTH_002, err.Error())
			return
		}
		if err.Error() == "email is already taken" {
			utils.HandleSendErrorResponse(ctx, http.StatusConflict, utils.AUTH_003, err.Error())
			return
		}
		utils.HandleInternalServerErrorResponse(ctx, err.Error())
		return
	}

	utils.SuccessResponse(ctx, http.StatusOK, response, "Profile updated successfully")
}

// CheckPasswordStrength handles password strength checking
// @Summary Check password strength
// @Description Check password strength with enhanced validation
// @Tags auth
// @Accept json
// @Produce json
// @Param request body map[string]string true "Password check request"
// @Success 200 {object} utils.APIResponse
// @Failure 400 {object} utils.ErrorResponse
// @Router /api/auth/check-password-strength [post]
func (c *AuthController) CheckPasswordStrength(ctx *gin.Context) {
	var req struct {
		Password string `json:"password" validate:"required"`
		Username string `json:"username,omitempty"`
	}

	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	if err := c.validator.Struct(&req); err != nil {
		utils.HandleValidationError(ctx, err)
		return
	}

	// Get password strength details
	score, warning, crackTime := c.customValidators.GetPasswordStrength(req.Password, req.Username)
	
	// Check if password meets enhanced policy
	policyError := c.customValidators.ValidatePasswordWithUsername(req.Password, req.Username)
	meetsPolicy := policyError == nil

	response := gin.H{
		"score":        score,
		"warning":      warning,
		"crackTime":    crackTime,
		"meetsPolicy":  meetsPolicy,
		"maxScore":     4,
	}

	if !meetsPolicy {
		response["policyError"] = policyError.Error()
	}

	utils.SuccessResponse(ctx, http.StatusOK, response, "Password strength checked successfully")
}

// Logout handles user logout
// @Summary Logout user
// @Description Logout user (client-side token removal)
// @Tags auth
// @Produce json
// @Security BearerAuth
// @Success 200 {object} utils.APIResponse
// @Router /api/auth/logout [post]
func (c *AuthController) Logout(ctx *gin.Context) {
	// In a stateless JWT implementation, logout is handled client-side
	// by removing the tokens from storage
	utils.SuccessResponse(ctx, http.StatusOK, nil, "Logout successful")
}