package utils

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCustomValidators_ValidateUsername(t *testing.T) {
	cv := NewCustomValidators()
	validator := cv.GetValidator()

	tests := []struct {
		name      string
		username  string
		expectErr bool
	}{
		{
			name:      "Valid username",
			username:  "john_doe",
			expectErr: false,
		},
		{
			name:      "Valid username with numbers",
			username:  "user123",
			expectErr: false,
		},
		{
			name:      "Valid username with hyphen",
			username:  "john-doe",
			expectErr: false,
		},
		{
			name:      "Too short username",
			username:  "ab",
			expectErr: true,
		},
		{
			name:      "Too long username",
			username:  "this_is_a_very_long_username_that_exceeds_fifty_characters_limit",
			expectErr: true,
		},
		{
			name:      "Username starting with underscore",
			username:  "_invalid",
			expectErr: true,
		},
		{
			name:      "Username ending with underscore",
			username:  "invalid_",
			expectErr: true,
		},
		{
			name:      "Username with consecutive underscores",
			username:  "invalid__name",
			expectErr: true,
		},
		{
			name:      "Username with consecutive hyphens",
			username:  "invalid--name",
			expectErr: true,
		},
		{
			name:      "Username with special characters",
			username:  "invalid@name",
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			type TestStruct struct {
				Username string `validate:"username"`
			}
			
			testStruct := TestStruct{Username: tt.username}
			err := validator.Struct(&testStruct)
			
			if tt.expectErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestCustomValidators_ValidateEmailStrong(t *testing.T) {
	cv := NewCustomValidators()
	validator := cv.GetValidator()

	tests := []struct {
		name     string
		email    string
		expectErr bool
	}{
		{
			name:      "Valid email",
			email:     "user@example.com",
			expectErr: false,
		},
		{
			name:      "Valid email with subdomain",
			email:     "user@mail.example.com",
			expectErr: false,
		},
		{
			name:      "Valid email with numbers",
			email:     "user123@example.com",
			expectErr: false,
		},
		{
			name:      "Invalid email format",
			email:     "invalid-email",
			expectErr: true,
		},
		{
			name:      "Email with consecutive dots",
			email:     "user..name@example.com",
			expectErr: true,
		},
		{
			name:      "Disposable email domain",
			email:     "user@10minutemail.com",
			expectErr: true,
		},
		{
			name:      "Another disposable email",
			email:     "user@mailinator.com",
			expectErr: true,
		},
		{
			name:      "Empty email",
			email:     "",
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			type TestStruct struct {
				Email string `validate:"email_strong"`
			}
			
			testStruct := TestStruct{Email: tt.email}
			err := validator.Struct(&testStruct)
			
			if tt.expectErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestCustomValidators_ValidatePasswordStrong(t *testing.T) {
	cv := NewCustomValidators()
	validator := cv.GetValidator()

	tests := []struct {
		name      string
		password  string
		expectErr bool
	}{
		{
			name:      "Strong password",
			password:  "StrongPass123!",
			expectErr: false,
		},
		{
			name:      "Strong password with special chars",
			password:  "MyP@ssw0rd#",
			expectErr: false,
		},
		{
			name:      "Too short password",
			password:  "Short1!",
			expectErr: true,
		},
		{
			name:      "Password without uppercase",
			password:  "weakpass123!",
			expectErr: true,
		},
		{
			name:      "Password without lowercase",
			password:  "STRONGPASS123!",
			expectErr: true,
		},
		{
			name:      "Password without numbers",
			password:  "StrongPassword!",
			expectErr: true,
		},
		{
			name:      "Password without special characters",
			password:  "StrongPass123",
			expectErr: true,
		},
		{
			name:      "Empty password",
			password:  "",
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			type TestStruct struct {
				Password string `validate:"password_strong"`
			}
			
			testStruct := TestStruct{Password: tt.password}
			err := validator.Struct(&testStruct)
			
			if tt.expectErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestCustomValidators_ValidateMeetingName(t *testing.T) {
	cv := NewCustomValidators()
	validator := cv.GetValidator()

	tests := []struct {
		name     string
		meetingName string
		expectErr bool
	}{
		{
			name:        "Valid meeting name",
			meetingName: "Team Meeting",
			expectErr:   false,
		},
		{
			name:        "Valid meeting name with numbers",
			meetingName: "Meeting 2024",
			expectErr:   false,
		},
		{
			name:        "Valid meeting name with special chars",
			meetingName: "Q1 Planning Session",
			expectErr:   false,
		},
		{
			name:        "Empty meeting name",
			meetingName: "",
			expectErr:   true,
		},
		{
			name:        "Too long meeting name",
			meetingName: "This is a very long meeting name that exceeds the maximum allowed length of two hundred and fifty five characters which should trigger a validation error because it is simply too long for the database field to handle properly and definitely goes over the limit we set for validation purposes",
			expectErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			type TestStruct struct {
				MeetingName string `validate:"meeting_name"`
			}
			
			testStruct := TestStruct{MeetingName: tt.meetingName}
			err := validator.Struct(&testStruct)
			
			if tt.expectErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestCustomValidators_ValidateChatContent(t *testing.T) {
	cv := NewCustomValidators()
	validator := cv.GetValidator()

	tests := []struct {
		name     string
		content  string
		expectErr bool
	}{
		{
			name:      "Valid chat content",
			content:   "Hello, how are you?",
			expectErr: false,
		},
		{
			name:      "Valid chat content with newlines",
			content:   "Hello\nHow are you?\nI'm fine!",
			expectErr: false,
		},
		{
			name:      "Valid chat content with tabs",
			content:   "Hello\tHow are you?",
			expectErr: false,
		},
		{
			name:      "Empty chat content",
			content:   "",
			expectErr: true,
		},
		{
			name:      "Too long chat content",
			content:   string(make([]byte, 2001)), // 2001 characters
			expectErr: true,
		},
		{
			name:      "Chat content with excessive whitespace",
			content:   "Hello    there", // 4 consecutive spaces
			expectErr: true,
		},
		{
			name:      "Chat content with control characters",
			content:   "Hello\x00there", // null character
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			type TestStruct struct {
				Content string `validate:"chat_content"`
			}
			
			testStruct := TestStruct{Content: tt.content}
			err := validator.Struct(&testStruct)
			
			if tt.expectErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestCustomValidators_GetValidationErrors(t *testing.T) {
	cv := NewCustomValidators()

	type TestStruct struct {
		Username string `validate:"username"`
		Email    string `validate:"email_strong"`
		Password string `validate:"password_strong"`
	}

	testStruct := TestStruct{
		Username: "ab", // too short
		Email:    "invalid-email", // invalid format
		Password: "weak", // too weak
	}

	err := cv.GetValidator().Struct(&testStruct)
	assert.Error(t, err)

	details := cv.GetValidationErrors(err)
	assert.Len(t, details, 3)

	// Check that we get detailed error information
	for _, detail := range details {
		assert.NotEmpty(t, detail.Field)
		assert.NotEmpty(t, detail.Tag)
		assert.NotEmpty(t, detail.Message)
	}
}

func TestCustomValidators_GetErrorMessage(t *testing.T) {
	cv := NewCustomValidators()

	// Test with actual validation errors to ensure error messages work correctly
	type TestStruct struct {
		Username string `validate:"username"`
		Email    string `validate:"email_strong"`
		Password string `validate:"password_strong"`
	}

	testStruct := TestStruct{
		Username: "ab", // too short
		Email:    "invalid-email", // invalid format
		Password: "weak", // too weak
	}

	err := cv.GetValidator().Struct(&testStruct)
	assert.Error(t, err)

	details := cv.GetValidationErrors(err)
	assert.Len(t, details, 3)

	// Verify error messages are descriptive and not empty
	for _, detail := range details {
		assert.NotEmpty(t, detail.Message)
		// Check that message contains Indonesian words or is descriptive
		assert.True(t, len(detail.Message) > 10, "Message should be descriptive: %s", detail.Message)
	}
}