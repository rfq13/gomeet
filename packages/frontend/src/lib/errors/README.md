# Centralized Error Handling System

Sistem error handling terpusat untuk aplikasi GoMeet yang menyediakan konsistensi, debugging capability, dan user-friendly error messages dalam Bahasa Indonesia.

## 📋 Daftar Isi

- [Struktur File](#struktur-file)
- [Quick Start](#quick-start)
- [Error Codes](#error-codes)
- [Error Categories](#error-categories)
- [Penggunaan](#penggunaan)
- [Error Store](#error-store)
- [Retry Mechanism](#retry-mechanism)
- [Error Logging](#error-logging)
- [Error Boundary](#error-boundary)
- [Testing](#testing)
- [Migration Guide](#migration-guide)

## 📁 Struktur File

```
src/lib/errors/
├── index.ts              # Export terpusat
├── types.ts              # Tipe dan interface error
├── messages.ts           # Pesan error Bahasa Indonesia
├── store.ts              # Centralized error store
├── logger.ts             # Structured logging system
├── retry.ts              # Retry mechanism
├── compatibility.ts      # Backward compatibility
├── tests.ts              # Test suite
└── README.md             # Dokumentasi ini
```

## 🚀 Quick Start

### Import Error Handling

```typescript
import {
  errorStore,
  ErrorCode,
  ErrorCategory,
  retryManager,
  errorLogger,
} from "$lib/errors";
```

### Menambah Error

```typescript
// Error sederhana
const error = errorStore.addError(
  ErrorCode.NETWORK_CONNECTION_FAILED,
  ErrorCategory.NETWORK,
  "Gagal terhubung ke server"
);

// Error dengan context lengkap
const detailedError = errorStore.addError(
  ErrorCode.VAL_INVALID_INPUT,
  ErrorCategory.VALIDATION,
  "Email tidak valid",
  new Error("Invalid email format"),
  {
    field: "email",
    value: "invalid-email",
    action: "user_registration",
  }
);
```

### Retry Operations

```typescript
try {
  const result = await retryManager.execute(
    async () => {
      const response = await fetch("/api/data");
      if (!response.ok) throw new Error("Network error");
      return response.json();
    },
    {
      maxRetries: 3,
      baseDelay: 1000,
      onRetry: (attempt, error) => {
        console.log(`Retry ${attempt}: ${error.message}`);
      },
    }
  );
} catch (error) {
  errorStore.addNetworkError(error, "Fetch data failed");
}
```

## 🔢 Error Codes

Error codes dikelompokkan berdasarkan kategori dengan prefix yang konsisten:

### Network Errors (`NET_*`)

- `NET_CONNECTION_FAILED` - Gagal terhubung ke server
- `NET_TIMEOUT` - Request timeout
- `NET_OFFLINE` - Tidak ada koneksi internet
- `NET_RATE_LIMITED` - Rate limit terlampaui
- `NET_SERVER_ERROR` - Server error (5xx)
- `NET_BAD_RESPONSE` - Response tidak valid

### Authentication Errors (`AUTH_*`)

- `AUTH_NOT_AUTHENTICATED` - Pengguna belum login
- `AUTH_INVALID_CREDENTIALS` - Kredensial salah
- `AUTH_TOKEN_EXPIRED` - Token kedaluwarsa
- `AUTH_TOKEN_INVALID` - Token tidak valid
- `AUTH_SESSION_EXPIRED` - Sesi berakhir

### Validation Errors (`VAL_*`)

- `VAL_INVALID_INPUT` - Input tidak valid
- `VAL_REQUIRED_FIELD_MISSING` - Field wajib kosong
- `VAL_INVALID_FORMAT` - Format tidak sesuai
- `VAL_TOO_SHORT` - Input terlalu pendek
- `VAL_TOO_LONG` - Input terlalu panjang

### Meeting Errors (`MTG_*`)

- `MTG_NOT_FOUND` - Meeting tidak ditemukan
- `MTG_ACCESS_DENIED` - Akses meeting ditolak
- `MTG_FULL` - Meeting penuh
- `MTG_ENDED` - Meeting sudah berakhir
- `MTG_NOT_STARTED` - Meeting belum dimulai

### Lihat `types.ts` untuk daftar lengkap semua error codes.

## 📂 Error Categories

- `NETWORK` - Error koneksi jaringan
- `AUTHENTICATION` - Error autentikasi
- `AUTHORIZATION` - Error otorisasi/permission
- `VALIDATION` - Error validasi input
- `WEBSOCKET` - Error koneksi WebSocket
- `WEBRTC` - Error WebRTC/connection media
- `LIVEKIT` - Error LiveKit service
- `MEETING` - Error terkait meeting
- `CHAT` - Error sistem chat
- `USER` - Error terkait user
- `SYSTEM` - Error sistem internal
- `UNKNOWN` - Error tidak terkategori

## 💡 Penggunaan

### 1. Basic Error Handling

```typescript
import { errorStore, ErrorCode, ErrorCategory } from "$lib/errors";

// Dalam service/API call
try {
  const response = await fetch("/api/meetings");
  if (!response.ok) {
    throw new Error("Failed to fetch meetings");
  }
  return await response.json();
} catch (error) {
  errorStore.addNetworkError(error, "Fetch meetings failed");
  throw error; // Re-throw jika perlu
}
```

### 2. Error dengan Context

```typescript
// Form validation
function validateEmail(email: string) {
  if (!email.includes("@")) {
    return errorStore.addValidationError("Email harus mengandung simbol @", {
      field: "email",
      value: email,
    });
  }
  return null;
}
```

### 3. Error Logging

```typescript
import { errorLogger } from "$lib/errors";

// Log error dengan context
errorLogger.logError(error, {
  component: "MeetingList",
  action: "load_meetings",
  userId: currentUser?.id,
});

// Log user action
errorLogger.logUserAction("click_join_meeting", {
  meetingId: "123",
  timestamp: Date.now(),
});
```

### 4. Custom Error Messages

```typescript
import { getErrorMessage } from "$lib/errors";

// Dapatkan pesan error dalam Bahasa Indonesia
const userMessage = getErrorMessage(ErrorCode.AUTH_INVALID_CREDENTIALS, {
  field: "email",
});
// Result: "Email atau kata sandi salah. Silakan coba lagi."
```

## 🏪 Error Store

Centralized error store menggunakan Svelte stores untuk state management global.

### Methods

```typescript
// Menambah error
const error = errorStore.addError(
  code,
  category,
  message,
  originalError,
  context
);

// Convenience methods
errorStore.addNetworkError(error, message, context);
errorStore.addAuthError(error, message, context);
errorStore.addValidationError(message, context);
errorStore.addWebRTCError(error, message, context);
errorStore.addMeetingError(error, message, context);

// Menghapus error
errorStore.clearError(errorId);
errorStore.clearAllErrors();

// Retry error
errorStore.retryError(errorId);

// Derived stores
$currentError; // Error terakhir
$hasErrors; // Apakah ada error
$retryableErrors; // Error yang bisa di-retry
$errorCountBySeverity; // Jumlah error per severity
```

### Reactivity

```svelte
<script>
  import { errorStore } from '$lib/errors';

  $: currentError = $currentError;
  $: hasErrors = $hasErrors;
</script>

{#if $hasErrors}
  <div class="error-container">
    {#each $errorStore.errors as error (error.id)}
      <ErrorItem {error} />
    {/each}
  </div>
{/if}
```

## 🔄 Retry Mechanism

Retry mechanism dengan berbagai strategi untuk menangani error yang bisa di-retry.

### Strategies

```typescript
import { RetryStrategy } from "$lib/errors";

// Exponential Backoff (default)
await retryManager.execute(operation, {
  strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
  maxRetries: 3,
  baseDelay: 1000,
});

// Linear Backoff
await retryManager.execute(operation, {
  strategy: RetryStrategy.LINEAR_BACKOFF,
  maxRetries: 5,
  baseDelay: 500,
});

// Fixed Delay
await retryManager.execute(operation, {
  strategy: RetryStrategy.FIXED_DELAY,
  maxRetries: 2,
  baseDelay: 2000,
});
```

### Network Retry

```typescript
// Auto-retry untuk network errors
const result = await retryManager.retryNetworkRequest(
  () => fetch("/api/data"),
  {
    maxRetries: 3,
    onRetry: (attempt, error) => {
      console.log(`Network retry ${attempt}: ${error.message}`);
    },
  }
);
```

### WebSocket Retry

```typescript
// Reconnect WebSocket dengan backoff
await retryManager.retryWebSocketConnection(() => websocket.connect(), {
  maxRetries: 10,
  baseDelay: 1000,
  maxDelay: 30000,
});
```

## 📝 Error Logging

Structured logging untuk debugging dan monitoring.

### Log Levels

```typescript
import { LogLevel } from "$lib/errors";

errorLogger.debug("Debug message", { context: "testing" });
errorLogger.info("User action", { action: "login", userId: 123 });
errorLogger.warn("Warning", { warning: "slow_connection" });
errorLogger.error("Error occurred", { error: originalError });
```

### Performance Logging

```typescript
// Log performance metrics
errorLogger.logPerformance("api_call", {
  duration: 1500,
  endpoint: "/api/meetings",
  success: false,
});
```

### Network Request Logging

```typescript
// Log network requests otomatis
errorLogger.logNetworkRequest("GET", "/api/meetings", {
  duration: 800,
  status: 200,
  success: true,
  responseSize: 2048,
});
```

## 🛡️ Error Boundary

Error boundary component untuk graceful error handling di UI.

### Basic Usage

```svelte
<script>
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
</script>

<ErrorBoundary>
  <!-- Content yang ingin diproteksi -->
  <MeetingList />
</ErrorBoundary>
```

### Advanced Configuration

```svelte
<ErrorBoundary
  position="top-right"
  maxErrors={5}
  autoDismiss={5000}
  onError={(error) => console.error('Boundary caught:', error)}
>
  <CriticalComponent />
</ErrorBoundary>
```

### Global Error Boundary

```svelte
<!-- Di +layout.svelte -->
<script>
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
</script>

<ErrorBoundary position="top-right">
  <slot />
</ErrorBoundary>
```

## 🧪 Testing

Test suite tersedia untuk memvalidasi implementasi error handling.

### Run Tests

```typescript
import { runErrorHandlingTests } from "$lib/errors/tests";

// Run all tests
await runErrorHandlingTests();

// Atau di browser console
runErrorTests();
```

### Test Categories

1. **Error Store Basics** - Testing add/clear errors
2. **Error Categories** - Validasi codes dan categories
3. **Retry Mechanism** - Testing retry strategies
4. **Error Logging** - Testing structured logging
5. **Bahasa Messages** - Testing Indonesian messages
6. **State Management** - Testing store reactivity
7. **Retry Configuration** - Testing custom retry options

## 🔄 Migration Guide

### From Legacy Error Handling

```typescript
// Legacy approach
try {
  await apiCall();
} catch (error) {
  console.error("API call failed:", error);
  alert("Something went wrong");
}

// New approach
try {
  await apiCall();
} catch (error) {
  errorStore.addNetworkError(error, "API call failed");
  // Error otomatis ditampilkan di UI
}
```

### Compatibility Layer

Gunakan compatibility layer untuk migrasi gradual:

```typescript
import {
  migrateLegacyError,
  wrapLegacyFunction,
} from "$lib/errors/compatibility";

// Migrate single error
const newError = migrateLegacyError(legacyError);

// Wrap legacy function
const wrappedFunction = wrapLegacyFunction(legacyFunction, {
  errorCategory: ErrorCategory.NETWORK,
  context: { component: "LegacyComponent" },
});
```

### Step-by-Step Migration

1. **Install error system** - Import dan setup
2. **Add error boundaries** - Wrap critical components
3. **Migrate API calls** - Gunakan errorStore.addNetworkError()
4. **Update form validation** - Gunakan errorStore.addValidationError()
5. **Add retry logic** - Implement retryManager untuk critical operations
6. **Enable logging** - Add structured logging
7. **Test thoroughly** - Run test suite
8. **Remove legacy code** - Clean up old error handling

## 🎯 Best Practices

### 1. Error Context

Selalu tambahkan context yang relevan:

```typescript
// ✅ Good
errorStore.addError(
  ErrorCode.NETWORK_CONNECTION_FAILED,
  ErrorCategory.NETWORK,
  "Failed to connect to API",
  error,
  {
    endpoint: "/api/meetings",
    userId: currentUser.id,
    attempt: 1,
  }
);

// ❌ Bad
errorStore.addError(
  ErrorCode.NETWORK_CONNECTION_FAILED,
  ErrorCategory.NETWORK,
  "Network error"
);
```

### 2. User-Friendly Messages

Gunakan pesan yang jelas dan actionable:

```typescript
// ✅ Good
"Gagal memuat meeting. Silakan periksa koneksi internet dan coba lagi.";

// ❌ Bad
"Network error occurred";
```

### 3. Retry Strategy

Pilih strategy yang tepat untuk setiap kasus:

```typescript
// Network requests - exponential backoff
await retryManager.retryNetworkRequest(fetchData, {
  maxRetries: 3,
  baseDelay: 1000,
});

// WebSocket connections - longer retry with jitter
await retryManager.retryWebSocketConnection(connectWS, {
  maxRetries: 10,
  baseDelay: 2000,
  maxDelay: 30000,
});
```

### 4. Error Boundaries

Gunakan error boundaries untuk melindungi critical UI:

```svelte
<!-- Protect critical user flows -->
<ErrorBoundary>
  <MeetingInterface />
</ErrorBoundary>

<!-- Protect entire app -->
<ErrorBoundary position="top-right">
  <slot />
</ErrorBoundary>
```

### 5. Logging

Log error dengan informasi yang cukup untuk debugging:

```typescript
errorLogger.logError(error, {
  component: "MeetingList",
  action: "load_meetings",
  userId: user?.id,
  sessionId: sessionId,
  timestamp: Date.now(),
  userAgent: navigator.userAgent,
});
```

## 🔧 Troubleshooting

### Common Issues

1. **Error tidak muncul di UI**
   - Pastikan ErrorBoundary sudah di-setup di layout
   - Check console untuk error JavaScript

2. **Retry tidak berfungsi**
   - Pastikan error termasuk kategori yang bisa di-retry
   - Check maxRetries configuration

3. **Pesan error dalam Bahasa Inggris**
   - Pastikan messages.ts sudah di-import
   - Check getErrorMessage() function

4. **TypeScript errors**
   - Pastikan semua types sudah di-import dari '$lib/errors'
   - Check interface definitions

### Debug Mode

Enable debug mode untuk detail logging:

```typescript
// Di development
if (import.meta.env.DEV) {
  errorLogger.setLevel(LogLevel.DEBUG);
}
```

## 📚 API Reference

Lihat file-file berikut untuk detail API lengkap:

- [`types.ts`](./types.ts) - Tipe dan interface
- [`store.ts`](./store.ts) - Error store API
- [`retry.ts`](./retry.ts) - Retry manager API
- [`logger.ts`](./logger.ts) - Logger API
- [`messages.ts`](./messages.ts) - Message utilities

## 🤝 Contributing

Untuk menambah error code baru:

1. Tambah enum di `types.ts`
2. Tambah pesan di `messages.ts`
3. Update tests di `tests.ts`
4. Update dokumentasi

---

**Note**: Sistem ini dirancang untuk backward compatibility. Kode yang ada akan terus berfungsi sambil bisa migrasi secara gradual ke sistem baru.
