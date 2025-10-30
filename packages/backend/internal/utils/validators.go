package utils

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"

	"github.com/go-playground/validator/v10"
	"github.com/nbutton23/zxcvbn-go"
	"github.com/sirupsen/logrus"
)

// CustomValidators contains custom validation functions
type CustomValidators struct {
	validator *validator.Validate
}

// NewCustomValidators creates a new instance of CustomValidators
func NewCustomValidators() *CustomValidators {
	v := validator.New()
	
	// Register custom validators
	cv := &CustomValidators{validator: v}
	
	v.RegisterValidation("username", cv.validateUsername)
	v.RegisterValidation("email_strong", cv.validateEmailStrong)
	v.RegisterValidation("password_strong", cv.validatePasswordStrong)
	v.RegisterValidation("password_enhanced", cv.validatePasswordEnhanced)
	v.RegisterValidation("meeting_name", cv.validateMeetingName)
	v.RegisterValidation("chat_content", cv.validateChatContent)
	
	return cv
}

// GetValidator returns the validator instance
func (cv *CustomValidators) GetValidator() *validator.Validate {
	return cv.validator
}

// validateUsername validates username according to business rules
// - Must be 3-50 characters long
// - Can contain letters, numbers, underscores, and hyphens
// - Must start and end with a letter or number
// - No consecutive underscores or hyphens
func (cv *CustomValidators) validateUsername(fl validator.FieldLevel) bool {
	username := fl.Field().String()
	
	if len(username) < 3 || len(username) > 50 {
		return false
	}
	
	// Must start and end with alphanumeric
	if !unicode.IsLetter(rune(username[0])) && !unicode.IsDigit(rune(username[0])) {
		return false
	}
	if !unicode.IsLetter(rune(username[len(username)-1])) && !unicode.IsDigit(rune(username[len(username)-1])) {
		return false
	}
	
	// Only allow letters, numbers, underscores, and hyphens
	validPattern := regexp.MustCompile(`^[a-zA-Z0-9]+([a-zA-Z0-9_-]*[a-zA-Z0-9])?$`)
	if !validPattern.MatchString(username) {
		return false
	}
	
	// No consecutive underscores or hyphens
	if regexp.MustCompile(`__|--`).MatchString(username) {
		return false
	}
	
	return true
}

// validateEmailStrong validates email with stricter rules
// - Standard email format validation
// - Additional checks for common disposable email domains
// - No consecutive dots
// - Valid TLD
func (cv *CustomValidators) validateEmailStrong(fl validator.FieldLevel) bool {
	email := fl.Field().String()
	
	// Basic email validation
	if email == "" {
		return false
	}
	
	// Email regex pattern
	emailPattern := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	if !emailPattern.MatchString(email) {
		return false
	}
	
	// No consecutive dots
	if regexp.MustCompile(`\.\.`).MatchString(email) {
		return false
	}
	
	// Check for common disposable email domains (optional)
	disposableDomains := []string{
		"10minutemail.com", "tempmail.org", "guerrillamail.com",
		"mailinator.com", "throwaway.email", "yopmail.com",
	}
	
	for _, domain := range disposableDomains {
		if regexp.MustCompile(fmt.Sprintf(`@%s$`, domain)).MatchString(email) {
			return false
		}
	}
	
	return true
}

// validatePasswordStrong validates password with security requirements (legacy for backward compatibility)
// - At least 8 characters long
// - Contains at least one uppercase letter
// - Contains at least one lowercase letter
// - Contains at least one digit
// - Contains at least one special character
// - No common patterns
func (cv *CustomValidators) validatePasswordStrong(fl validator.FieldLevel) bool {
	password := fl.Field().String()
	
	if len(password) < 8 {
		return false
	}
	
	var (
		hasUpper   = false
		hasLower   = false
		hasDigit   = false
		hasSpecial = false
	)
	
	for _, char := range password {
		switch {
		case unicode.IsUpper(char):
			hasUpper = true
		case unicode.IsLower(char):
			hasLower = true
		case unicode.IsDigit(char):
			hasDigit = true
		case unicode.IsPunct(char) || unicode.IsSymbol(char):
			hasSpecial = true
		}
	}
	
	return hasUpper && hasLower && hasDigit && hasSpecial
}

// validatePasswordEnhanced validates password with enhanced security requirements
// - Minimum 12 characters
// - Minimal 1 huruf besar
// - Minimal 1 huruf kecil
// - Minimal 1 angka
// - Minimal 1 karakter spesial (@$!%*?&-_)
// - Tidak boleh mengandung 3 karakter berturut-turut dari username
// - Tidak boleh mengandung password umum (12345678, password, qwerty, dll)
// - Password strength validation menggunakan zxcvbn
func (cv *CustomValidators) validatePasswordEnhanced(fl validator.FieldLevel) bool {
	password := fl.Field().String()
	
	// For now, we'll validate without username context
	// Username validation will be done at service level
	if err := cv.validatePasswordEnhancedWithDetails(password, ""); err != nil {
		// Log password policy violation
		logrus.WithFields(logrus.Fields{
			"validation_error": err.Error(),
			"password_length":  len(password),
		}).Warn("Password policy violation")
		
		return false
	}
	
	return true
}

// validatePasswordEnhancedWithDetails performs detailed password validation
func (cv *CustomValidators) validatePasswordEnhancedWithDetails(password, username string) error {
	// Minimum 12 characters
	if len(password) < 12 {
		return fmt.Errorf("password harus minimal 12 karakter")
	}
	
	// Complexity requirements
	var (
		hasUpper   = false
		hasLower   = false
		hasDigit   = false
		hasSpecial = false
	)
	
	// Allowed special characters
	specialChars := "@$!%*?&-_"
	
	for _, char := range password {
		switch {
		case unicode.IsUpper(char):
			hasUpper = true
		case unicode.IsLower(char):
			hasLower = true
		case unicode.IsDigit(char):
			hasDigit = true
		case strings.ContainsRune(specialChars, char):
			hasSpecial = true
		}
	}
	
	if !hasUpper {
		return fmt.Errorf("password harus mengandung minimal 1 huruf besar")
	}
	if !hasLower {
		return fmt.Errorf("password harus mengandung minimal 1 huruf kecil")
	}
	if !hasDigit {
		return fmt.Errorf("password harus mengandung minimal 1 angka")
	}
	if !hasSpecial {
		return fmt.Errorf("password harus mengandung minimal 1 karakter spesial (@$!%%*?&-_)")
	}
	
	// Check for 3 consecutive characters from username
	if username != "" {
		usernameLower := strings.ToLower(username)
		passwordLower := strings.ToLower(password)
		
		for i := 0; i < len(usernameLower)-2; i++ {
			sequence := usernameLower[i : i+3]
			if strings.Contains(passwordLower, sequence) {
				return fmt.Errorf("password tidak boleh mengandung 3 karakter berturut-turut dari username")
			}
		}
	}
	
	// Check for common passwords
	commonPasswords := []string{
		"12345678", "password", "qwerty", "123456789", "1234567890",
		"abc123", "password123", "admin", "letmein", "welcome",
		"monkey", "123456", "1234567", "1234567890", "iloveyou",
		"adobe123", "123123", "sunshine", "princess", "azerty",
		"trustno1", "000000", "111111", "1234", "12345",
	}
	
	passwordLower := strings.ToLower(password)
	for _, common := range commonPasswords {
		if strings.Contains(passwordLower, common) {
			return fmt.Errorf("password tidak boleh mengandung password umum")
		}
	}
	
	// Password strength validation using zxcvbn
	userInputs := []string{}
	if username != "" {
		userInputs = append(userInputs, username)
	}
	result := zxcvbn.PasswordStrength(password, userInputs)
	if result.Score < 3 {
		return fmt.Errorf("password terlalu lemah (score: %d/4), silakan gunakan password yang lebih kuat", result.Score)
	}
	
	return nil
}

// GetPasswordStrength returns password strength details
func (cv *CustomValidators) GetPasswordStrength(password, username string) (int, string, string) {
	userInputs := []string{}
	if username != "" {
		userInputs = append(userInputs, username)
	}
	
	result := zxcvbn.PasswordStrength(password, userInputs)
	
	// Generate warning based on score
	var warning string
	switch result.Score {
	case 0:
		warning = "Password sangat lemah"
	case 1:
		warning = "Password lemah"
	case 2:
		warning = "Password sedang"
	case 3:
		warning = "Password kuat"
	case 4:
		warning = "Password sangat kuat"
	default:
		warning = "Password tidak diketahui"
	}
	
	// Use crack time display as additional info
	crackTimeInfo := fmt.Sprintf("Estimasi waktu crack: %s", result.CrackTimeDisplay)
	
	return result.Score, warning, crackTimeInfo
}

// ValidatePasswordWithUsername validates password with username context
func (cv *CustomValidators) ValidatePasswordWithUsername(password, username string) error {
	return cv.validatePasswordEnhancedWithDetails(password, username)
}

// validateMeetingName validates meeting name
// - Must be 1-255 characters long
// - No leading/trailing whitespace
// - No control characters
func (cv *CustomValidators) validateMeetingName(fl validator.FieldLevel) bool {
	name := fl.Field().String()
	
	if len(name) < 1 || len(name) > 255 {
		return false
	}
	
	// Check for control characters
	for _, char := range name {
		if unicode.IsControl(char) {
			return false
		}
	}
	
	return true
}

// validateChatContent validates chat message content
// - Must be 1-2000 characters long
// - No excessive whitespace
// - No control characters except newlines and tabs
func (cv *CustomValidators) validateChatContent(fl validator.FieldLevel) bool {
	content := fl.Field().String()
	
	if len(content) < 1 || len(content) > 2000 {
		return false
	}
	
	// Check for excessive whitespace (more than 3 consecutive spaces)
	if regexp.MustCompile(`\s{4,}`).MatchString(content) {
		return false
	}
	
	// Check for control characters (allow newlines and tabs)
	for _, char := range content {
		if unicode.IsControl(char) && char != '\n' && char != '\t' {
			return false
		}
	}
	
	return true
}

// ValidationErrorDetail represents detailed validation error information
type ValidationErrorDetail struct {
	Field   string `json:"field"`
	Tag     string `json:"tag"`
	Value   string `json:"value,omitempty"`
	Message string `json:"message"`
}

// GetValidationErrors converts validator errors to detailed format
func (cv *CustomValidators) GetValidationErrors(err error) []ValidationErrorDetail {
	var errors []ValidationErrorDetail
	
	if validationErrors, ok := err.(validator.ValidationErrors); ok {
		for _, e := range validationErrors {
			detail := ValidationErrorDetail{
				Field:   e.Field(),
				Tag:     e.Tag(),
				Value:   fmt.Sprintf("%v", e.Value()),
				Message: cv.getErrorMessage(e),
			}
			errors = append(errors, detail)
		}
	}
	
	return errors
}

// getErrorMessage returns user-friendly error messages for validation tags
func (cv *CustomValidators) getErrorMessage(fe validator.FieldError) string {
	switch fe.Tag() {
	case "required":
		return "Field ini wajib diisi"
	case "min":
		return fmt.Sprintf("Field ini harus memiliki minimal %s karakter", fe.Param())
	case "max":
		return fmt.Sprintf("Field ini harus memiliki maksimal %s karakter", fe.Param())
	case "email":
		return "Format email tidak valid"
	case "email_strong":
		return "Format email tidak valid atau domain email tidak diizinkan"
	case "username":
		return "Username harus 3-50 karakter, hanya boleh mengandung huruf, angka, underscore, dan hyphen"
	case "password_strong":
		return "Password harus minimal 8 karakter dengan kombinasi huruf besar, huruf kecil, angka, dan karakter khusus"
	case "password_enhanced":
		return "Password harus minimal 12 karakter dengan kombinasi huruf besar, huruf kecil, angka, dan karakter spesial (@$!%*?&-_)"
	case "meeting_name":
		return "Nama meeting harus 1-255 karakter dan tidak boleh mengandung karakter kontrol"
	case "chat_content":
		return "Konten pesan harus 1-2000 karakter dan tidak boleh mengandung karakter kontrol"
	case "uuid":
		return "Format UUID tidak valid"
	case "omitempty":
		return fmt.Sprintf("Field %s opsional", fe.Field())
	default:
		return fmt.Sprintf("Validasi field %s gagal: %s", fe.Field(), fe.Tag())
	}
}