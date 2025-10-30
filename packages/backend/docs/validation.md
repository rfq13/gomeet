# API Validation Documentation

## Overview

Dokumentasi ini menjelaskan implementasi validasi input yang telah diperbaiki di API endpoints GoMeet backend. Sistem validasi telah ditingkatkan dengan custom validators dan structured error handling untuk meningkatkan security dan user experience.

## Custom Validators

### 1. Username Validator (`username`)

**Deskripsi**: Validasi username dengan aturan ketat untuk keamanan.

**Aturan**:

- Panjang: 3-50 karakter
- Karakter yang diizinkan: huruf, angka, underscore (\_), dan hyphen (-)
- Harus dimulai dan diakhiri dengan huruf atau angka
- Tidak boleh mengandung underscore atau hyphen berurutan

**Contoh Valid**:

- `john_doe`
- `user123`
- `john-doe`
- `test_user_2024`

**Contoh Invalid**:

- `ab` (terlalu pendek)
- `_invalid` (dimulai dengan underscore)
- `invalid_` (diakhiri dengan underscore)
- `invalid__name` (underscore berurutan)
- `invalid--name` (hyphen berurutan)
- `invalid@name` (karakter khusus tidak diizinkan)

### 2. Email Strong Validator (`email_strong`)

**Deskripsi**: Validasi email dengan aturan yang lebih ketat dari validator standar.

**Aturan**:

- Format email standar harus valid
- Tidak boleh mengandung titik berurutan
- Memblokir domain email disposable yang umum
- TLD (Top Level Domain) harus valid

**Contoh Valid**:

- `user@example.com`
- `user123@mail.example.com`
- `test.user@company.co.id`

**Contoh Invalid**:

- `invalid-email` (format tidak valid)
- `user..name@example.com` (titik berurutan)
- `user@10minutemail.com` (domain disposable)
- `user@mailinator.com` (domain disposable)

### 3. Password Strong Validator (`password_strong`)

**Deskripsi**: Validasi password dengan persyaratan keamanan yang kuat.

**Aturan**:

- Minimal 8 karakter
- Mengandung minimal 1 huruf besar
- Mengandung minimal 1 huruf kecil
- Mengandung minimal 1 angka
- Mengandung minimal 1 karakter khusus

**Contoh Valid**:

- `StrongPass123!`
- `MyP@ssw0rd#`
- `Secure123$`

**Contoh Invalid**:

- `short1!` (terlalu pendek)
- `weakpass123!` (tidak ada huruf besar)
- `STRONGPASS123!` (tidak ada huruf kecil)
- `StrongPassword!` (tidak ada angka)
- `StrongPass123` (tidak ada karakter khusus)

### 4. Meeting Name Validator (`meeting_name`)

**Deskripsi**: Validasi nama meeting untuk memastikan data yang bersih.

**Aturan**:

- Panjang: 1-255 karakter
- Tidak boleh mengandung karakter kontrol
- Tidak boleh kosong

**Contoh Valid**:

- `Team Meeting`
- `Meeting 2024`
- `Q1 Planning Session`

**Contoh Invalid**:

- `` (kosong)
- String dengan panjang > 255 karakter
- String dengan karakter kontrol

### 5. Chat Content Validator (`chat_content`)

**Deskripsi**: Validasi konten pesan chat untuk mencegah abuse.

**Aturan**:

- Panjang: 1-2000 karakter
- Tidak boleh mengandung whitespace berlebih (4+ spasi berurutan)
- Tidak boleh mengandung karakter kontrol (kecuali newline dan tab)

**Contoh Valid**:

- `Hello, how are you?`
- `Hello\nHow are you?\nI'm fine!` (dengan newline)
- `Hello\tHow are you?` (dengan tab)

**Contoh Invalid**:

- `` (kosong)
- String dengan panjang > 2000 karakter
- `Hello    there` (4 spasi berurutan)
- String dengan karakter kontrol

## Error Response Format

### Structured Validation Error Response

Ketika validasi gagal, API akan merespons dengan format error yang terstruktur:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_001",
    "message": "Input validation failed",
    "details": [
      {
        "field": "Username",
        "tag": "username",
        "value": "ab",
        "message": "Username harus 3-50 karakter, hanya boleh mengandung huruf, angka, underscore, dan hyphen"
      },
      {
        "field": "Email",
        "tag": "email_strong",
        "value": "invalid-email",
        "message": "Format email tidak valid atau domain email tidak diizinkan"
      },
      {
        "field": "Password",
        "tag": "password_strong",
        "value": "weak",
        "message": "Password harus minimal 8 karakter dengan kombinasi huruf besar, huruf kecil, angka, dan karakter khusus"
      }
    ]
  }
}
```

### Error Codes

- `VALIDATION_001`: Input validation failed
- `VALIDATION_002`: At least one field must be provided (untuk update operations)

## Implementation Details

### Controller Integration

Semua controller telah diintegrasikan dengan custom validators:

1. **AuthController**: Validasi untuk register, login, update profile, dan update password
2. **MeetingController**: Validasi untuk create dan update meeting
3. **ChatController**: Validasi untuk send dan update message
4. **PublicUserController**: Validasi untuk create public user

### Model Updates

Model request telah diperbarui untuk menggunakan custom validation tags:

```go
// Contoh di user.go
type RegisterRequest struct {
    Username string `json:"username" validate:"required,username"`
    Email    string `json:"email" validate:"required,email_strong"`
    Password string `json:"password" validate:"required,password_strong"`
}
```

### Error Handling

- Fungsi `ValidationError()` di `response.go` telah ditingkatkan untuk mendukung detailed error messages
- Custom validators diset dalam context untuk error handling yang konsisten
- Pesan error dalam Bahasa Indonesia untuk user experience yang lebih baik

## Testing

### Test Coverage

Custom validators telah dilengkapi dengan comprehensive test cases:

- **Username Validator**: 10 test cases mencakup berbagai skenario valid/invalid
- **Email Strong Validator**: 8 test cases untuk format dan domain validation
- **Password Strong Validator**: 8 test cases untuk persyaratan keamanan
- **Meeting Name Validator**: 5 test cases untuk panjang dan karakter
- **Chat Content Validator**: 7 test cases untuk konten dan format
- **Error Message Testing**: Validasi format dan bahasa pesan error

### Running Tests

```bash
cd packages/backend
go test ./internal/utils -v
```

## Security Benefits

1. **Prevents Injection**: Validasi ketat mencegah malicious input
2. **Blocks Disposable Emails**: Mengurangi spam dan fake accounts
3. **Strong Password Requirements**: Meningkatkan keamanan akun
4. **Input Sanitization**: Mencegah karakter kontrol dan whitespace abuse
5. **Consistent Validation**: Mengurangi vulnerabilities dari inconsistent validation

## Migration Guide

### For Frontend Developers

1. Update form validation rules sesuai dengan aturan baru
2. Handle structured error response format
3. Display Indonesian error messages kepada users
4. Implement client-side validation yang sesuai dengan backend rules

### For API Consumers

1. Update request payload untuk memenuhi validation requirements
2. Handle new error response format
3. Implement proper error handling untuk validation errors
4. Update test cases untuk API integration

## Best Practices

1. **Always Validate Input**: Jangan percaya input dari client
2. **Use Custom Validators**: Lebih spesifik dan aman daripada generic validators
3. **Provide Clear Error Messages**: Bantu user memperbaiki input mereka
4. **Test Validation Rules**: Pastikan semua edge cases tercover
5. **Keep Validation Consistent**: Gunakan rules yang sama di semua endpoints
6. **Monitor Validation Failures**: Track untuk mengidentifikasi potential attacks
