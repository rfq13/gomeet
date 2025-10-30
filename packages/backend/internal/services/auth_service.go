package services

import (
	"errors"
	"fmt"

	"github.com/sirupsen/logrus"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/filosofine/gomeet-backend/internal/cache"
	"github.com/filosofine/gomeet-backend/internal/models"
	"github.com/filosofine/gomeet-backend/internal/utils"
)

type AuthService struct {
	db         *gorm.DB
	jwtService *JWTService
	cacheRepo  *cache.CacheRepository
}

type AuthResponse struct {
	User         models.UserResponse `json:"user"`
	AccessToken  string              `json:"accessToken"`
	RefreshToken string              `json:"refreshToken"`
}

func NewAuthService(db *gorm.DB, jwtService *JWTService, cacheRepo *cache.CacheRepository) *AuthService {
	return &AuthService{
		db:         db,
		jwtService: jwtService,
		cacheRepo:  cacheRepo,
	}
}

func (s *AuthService) Register(req *models.RegisterRequest) (*AuthResponse, error) {
	// Check if user already exists
	var existingUser models.User
	if err := s.db.Where("email = ?", req.Email).First(&existingUser).Error; err == nil {
		return nil, errors.New("user with this email already exists")
	}

	// Enhanced password validation with username context
	customValidators := utils.NewCustomValidators()
	if err := customValidators.ValidatePasswordWithUsername(req.Password, req.Username); err != nil {
		// Log password policy violation
		logrus.WithFields(logrus.Fields{
			"username":         req.Username,
			"email":            req.Email,
			"validation_error": err.Error(),
			"action":           "register",
		}).Warn("Password policy violation during registration")
		
		return nil, fmt.Errorf("password tidak memenuhi policy: %w", err)
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	// Create user
	user := &models.User{
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: string(hashedPassword),
	}

	if err := s.db.Create(user).Error; err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	// Log successful registration
	logrus.WithFields(logrus.Fields{
		"user_id":  user.ID,
		"username": user.Username,
		"email":    user.Email,
		"action":   "register",
	}).Info("User registered successfully")

	// Generate tokens
	tokens, err := s.jwtService.GenerateTokenPair(user)
	if err != nil {
		return nil, fmt.Errorf("failed to generate tokens: %w", err)
	}

	return &AuthResponse{
		User:         user.ToResponse(),
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
	}, nil
}

func (s *AuthService) Login(req *models.LoginRequest) (*AuthResponse, error) {
	// Find user by email
	var user models.User
	if err := s.db.Where("email = ?", req.Email).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("invalid credentials")
		}
		return nil, fmt.Errorf("failed to find user: %w", err)
	}

	// Check password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, errors.New("invalid credentials")
	}

	// Generate tokens
	tokens, err := s.jwtService.GenerateTokenPair(&user)
	if err != nil {
		return nil, fmt.Errorf("failed to generate tokens: %w", err)
	}

	return &AuthResponse{
		User:         user.ToResponse(),
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
	}, nil
}

func (s *AuthService) RefreshToken(refreshToken string) (*AuthResponse, error) {
	// Validate refresh token
	claims, err := s.jwtService.ValidateRefreshToken(refreshToken)
	if err != nil {
		return nil, errors.New("invalid refresh token")
	}

	// Find user
	var user models.User
	if err := s.db.Where("id = ?", claims.UserID).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("user not found")
		}
		return nil, fmt.Errorf("failed to find user: %w", err)
	}

	// Generate new tokens
	tokens, err := s.jwtService.GenerateTokenPair(&user)
	if err != nil {
		return nil, fmt.Errorf("failed to generate tokens: %w", err)
	}

	return &AuthResponse{
		User:         user.ToResponse(),
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
	}, nil
}

func (s *AuthService) GetUserByID(userID string) (*models.User, error) {
	// Try to get from cache first
	userResponse, found, err := s.cacheRepo.GetUserProfile(userID)
	if err != nil {
		// Log error but continue to database
		fmt.Printf("Cache error: %v\n", err)
	}
	
	if found {
		// Convert UserResponse back to User model
		user := &models.User{
			ID:        userResponse.ID,
			Username:  userResponse.Username,
			Email:     userResponse.Email,
			AvatarURL: userResponse.AvatarURL,
			CreatedAt: userResponse.CreatedAt,
		}
		return user, nil
	}

	// Cache miss, get from database
	var user models.User
	if err := s.db.Where("id = ?", userID).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("user not found")
		}
		return nil, fmt.Errorf("failed to find user: %w", err)
	}

	// Cache the user response
	userResponseCache := user.ToResponse()
	if err := s.cacheRepo.SetUserProfile(userID, &userResponseCache); err != nil {
		// Log error but don't fail the operation
		fmt.Printf("Failed to cache user profile: %v\n", err)
	}

	return &user, nil
}

func (s *AuthService) UpdatePassword(userID string, req *models.UpdatePasswordRequest) error {
	// Find user
	var user models.User
	if err := s.db.Where("id = ?", userID).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("user not found")
		}
		return fmt.Errorf("failed to find user: %w", err)
	}

	// Verify current password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.CurrentPassword)); err != nil {
		return errors.New("current password is incorrect")
	}

	// Enhanced password validation with username context
	customValidators := utils.NewCustomValidators()
	if err := customValidators.ValidatePasswordWithUsername(req.NewPassword, user.Username); err != nil {
		// Log password policy violation
		logrus.WithFields(logrus.Fields{
			"user_id":          user.ID,
			"username":         user.Username,
			"validation_error": err.Error(),
			"action":           "update_password",
		}).Warn("Password policy violation during password update")
		
		return fmt.Errorf("password tidak memenuhi policy: %w", err)
	}

	// Hash new password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash new password: %w", err)
	}

	// Update password
	if err := s.db.Model(&user).Update("password_hash", string(hashedPassword)).Error; err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	// Log successful password update
	logrus.WithFields(logrus.Fields{
		"user_id":  user.ID,
		"username": user.Username,
		"action":   "update_password",
	}).Info("Password updated successfully")

	// Invalidate user cache
	if err := s.cacheRepo.InvalidateUserProfile(userID); err != nil {
		// Log error but don't fail the operation
		logrus.WithFields(logrus.Fields{
			"user_id":  user.ID,
			"error":    err.Error(),
			"action":   "invalidate_cache",
		}).Warn("Failed to invalidate user profile cache")
	}

	return nil
}

func (s *AuthService) UpdateProfile(userID string, username, email string) (*models.UserResponse, error) {
	var user models.User
	if err := s.db.Where("id = ?", userID).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("user not found")
		}
		return nil, fmt.Errorf("failed to find user: %w", err)
	}

	// Check if email is being changed and if it's already taken
	if email != user.Email {
		var existingUser models.User
		if err := s.db.Where("email = ? AND id != ?", email, userID).First(&existingUser).Error; err == nil {
			return nil, errors.New("email is already taken")
		}
	}

	// Update user
	updates := make(map[string]interface{})
	if username != "" {
		updates["username"] = username
	}
	if email != "" {
		updates["email"] = email
	}

	if err := s.db.Model(&user).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("failed to update profile: %w", err)
	}

	// Refresh user data
	if err := s.db.Where("id = ?", userID).First(&user).Error; err != nil {
		return nil, fmt.Errorf("failed to refresh user data: %w", err)
	}

	response := user.ToResponse()

	// Update cache with new user data
	if err := s.cacheRepo.SetUserProfile(userID, &response); err != nil {
		// Log error but don't fail the operation
		fmt.Printf("Failed to update user profile cache: %v\n", err)
	}

	return &response, nil
}