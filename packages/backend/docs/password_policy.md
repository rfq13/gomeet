# Password Policy Documentation

## Overview

This document describes the enhanced password policy implemented in GoMeet Backend API to improve security and protect user accounts.

## Enhanced Password Requirements

### Minimum Requirements

- **Minimum Length**: 12 characters
- **Uppercase Letters**: At least 1 (A-Z)
- **Lowercase Letters**: At least 1 (a-z)
- **Numbers**: At least 1 (0-9)
- **Special Characters**: At least 1 from (@$!%\*?&-\_)

### Additional Security Checks

- **Username Sequence**: Password must not contain 3 consecutive characters from the username
- **Common Passwords**: Password must not contain common passwords (12345678, password, qwerty, etc.)
- **Password Strength**: Minimum score of 3/4 using zxcvbn library

### Allowed Special Characters

The following special characters are allowed and required:

- `@` (at sign)
- `$` (dollar sign)
- `!` (exclamation mark)
- `%` (percent sign)
- `*` (asterisk)
- `?` (question mark)
- `&` (ampersand)
- `-` (hyphen)
- `_` (underscore)

## API Endpoints

### 1. User Registration

**Endpoint**: `POST /api/v1/auth/register`

**Request Body**:

```json
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "SecureP@ssw0rd123"
}
```

**Password Validation**: Uses enhanced password policy (`password_enhanced` validator)

### 2. Update Password

**Endpoint**: `PUT /api/v1/auth/update-password`

**Request Body**:

```json
{
  "currentPassword": "OldP@ssw0rd123",
  "newPassword": "NewSecureP@ssw0rd456"
}
```

**Password Validation**: Uses enhanced password policy with username context

### 3. Check Password Strength

**Endpoint**: `POST /api/v1/auth/check-password-strength`

**Request Body**:

```json
{
  "password": "MyP@ssw0rd123",
  "username": "john_doe"
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "score": 3,
    "warning": "Password kuat",
    "crackTime": "Estimasi waktu crack: centuries",
    "meetsPolicy": true,
    "maxScore": 4
  },
  "message": "Password strength checked successfully"
}
```

**Response with Policy Violation**:

```json
{
  "success": true,
  "data": {
    "score": 1,
    "warning": "Password lemah",
    "crackTime": "Estimasi waktu crack: minutes",
    "meetsPolicy": false,
    "maxScore": 4,
    "policyError": "password harus minimal 12 karakter"
  },
  "message": "Password strength checked successfully"
}
```

## Password Strength Scoring

The password strength is scored using the zxcvbn library with the following scale:

- **Score 0**: Very weak (instant to minutes)
- **Score 1**: Weak (minutes to hours)
- **Score 2**: Medium (hours to days)
- **Score 3**: Strong (days to years)
- **Score 4**: Very strong (years to centuries)

**Minimum Required Score**: 3/4

## Error Handling

### Validation Errors

When password validation fails, the API returns detailed error messages:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "password tidak memenuhi policy: password harus minimal 12 karakter"
  }
}
```

### Common Error Messages

- `password harus minimal 12 karakter`
- `password harus mengandung minimal 1 huruf besar`
- `password harus mengandung minimal 1 huruf kecil`
- `password harus mengandung minimal 1 angka`
- `password harus mengandung minimal 1 karakter spesial (@$!%*?&-_)`
- `password tidak boleh mengandung 3 karakter berturut-turut dari username`
- `password tidak boleh mengandung password umum`
- `password terlalu lemah (score: X/4), silakan gunakan password yang lebih kuat`

## Security Features

### Logging

All password policy violations are logged with the following information:

- Username
- Email (for registration)
- Validation error details
- Action (register/update_password)
- Timestamp

### Rate Limiting

Password-related endpoints are protected with stricter rate limiting:

- **Auth endpoints**: 5 requests per minute per IP
- **Password strength check**: 5 requests per minute per IP

### Backward Compatibility

For existing users, the system maintains backward compatibility:

- Legacy `password_strong` validator (8 characters minimum) is still available
- New registrations and password updates must use enhanced policy
- Existing users can continue using their current passwords

## Implementation Details

### Validation Flow

1. **Basic Validation**: Length and character requirements
2. **Username Check**: Prevent 3 consecutive characters from username
3. **Common Password Check**: Block known weak passwords
4. **Strength Assessment**: zxcvbn library scoring
5. **Final Validation**: All requirements must be met

### Technical Components

- **Validators**: Custom Go validators in `internal/utils/validators.go`
- **Service Layer**: Enhanced validation in `internal/services/auth_service.go`
- **Controller Layer**: New endpoint for password strength checking
- **Logging**: Structured logging with logrus

## Best Practices

### Password Creation

- Use passphrases combining multiple words
- Include numbers and special characters
- Avoid personal information (name, birthday, etc.)
- Don't reuse passwords from other services
- Consider using a password manager

### Examples of Good Passwords

- `SecureP@ssw0rd123`
- `MyStr0ng#P@ssphrase`
- `C0mplex&Secur3ty2024`
- `L0ngP@ssw0rdWithNumbers!`

### Examples of Bad Passwords

- `password123` (contains common password)
- `john123` (contains username sequence)
- `short` (too short)
- `nouppercase1` (missing uppercase)
- `NOLOWERCASE1` (missing lowercase)

## Migration Guide

### For New Users

- All new registrations must comply with enhanced password policy
- Password strength checking is available before registration

### For Existing Users

- Current passwords remain valid (backward compatibility)
- Password updates must comply with enhanced policy
- Users can check password strength before updating

## Testing

### Test Cases

1. **Minimum Requirements**: Test all character requirements
2. **Username Validation**: Test username sequence detection
3. **Common Passwords**: Test common password rejection
4. **Strength Scoring**: Test zxcvbn integration
5. **Error Handling**: Test all error scenarios

### API Testing

Use the `/api/v1/auth/check-password-strength` endpoint to test password compliance before registration or password updates.

## Support

For questions or issues related to the password policy implementation:

- Check the API documentation
- Review the validation error messages
- Contact the development team for technical support
