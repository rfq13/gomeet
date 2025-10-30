import { ErrorCode, ErrorCategory } from "./types";

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  // Network Errors
  [ErrorCode.NETWORK_OFFLINE]:
    "Tidak ada koneksi internet. Silakan periksa koneksi Anda.",
  [ErrorCode.NETWORK_TIMEOUT]: "Koneksi terlalu lama. Silakan coba lagi.",
  [ErrorCode.NETWORK_CONNECTION_FAILED]:
    "Gagal terhubung ke server. Silakan coba lagi.",
  [ErrorCode.NETWORK_SERVER_ERROR]:
    "Server sedang bermasalah. Silakan coba beberapa saat lagi.",
  [ErrorCode.NETWORK_RATE_LIMIT]:
    "Terlalu banyak permintaan. Silakan tunggu beberapa saat.",

  // Authentication Errors
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: "Email atau password salah.",
  [ErrorCode.AUTH_TOKEN_EXPIRED]: "Sesi telah berakhir. Silakan login kembali.",
  [ErrorCode.AUTH_TOKEN_INVALID]: "Token tidak valid. Silakan login kembali.",
  [ErrorCode.AUTH_NOT_AUTHENTICATED]:
    "Anda belum login. Silakan login terlebih dahulu.",
  [ErrorCode.AUTH_SESSION_EXPIRED]:
    "Sesi Anda telah berakhir. Silakan login kembali.",
  [ErrorCode.AUTH_LOGIN_REQUIRED]:
    "Anda perlu login untuk mengakses halaman ini.",

  // Authorization Errors
  [ErrorCode.PERM_ACCESS_DENIED]: "Anda tidak memiliki akses ke halaman ini.",
  [ErrorCode.PERM_INSUFFICIENT_PERMISSIONS]:
    "Anda tidak memiliki izin untuk melakukan tindakan ini.",
  [ErrorCode.PERM_RESOURCE_FORBIDDEN]:
    "Anda tidak dapat mengakses resource ini.",

  // Validation Errors
  [ErrorCode.VAL_INVALID_INPUT]: "Input tidak valid.",
  [ErrorCode.VAL_REQUIRED_FIELD_MISSING]: "Field ini wajib diisi.",
  [ErrorCode.VAL_INVALID_FORMAT]: "Format tidak sesuai.",
  [ErrorCode.VAL_INVALID_LENGTH]: "Panjang karakter tidak sesuai.",
  [ErrorCode.VAL_INVALID_EMAIL]: "Format email tidak valid.",
  [ErrorCode.VAL_PASSWORD_TOO_WEAK]:
    "Password terlalu lemah. Gunakan kombinasi huruf, angka, dan simbol.",

  // WebSocket Errors
  [ErrorCode.WS_CONNECTION_FAILED]: "Gagal terhubung ke server real-time.",
  [ErrorCode.WS_CONNECTION_LOST]:
    "Koneksi real-time terputus. Mencoba menghubungkan kembali...",
  [ErrorCode.WS_RECONNECT_FAILED]:
    "Gagal menghubungkan kembali ke server real-time.",
  [ErrorCode.WS_MESSAGE_PARSE_ERROR]:
    "Terjadi kesalahan dalam memproses pesan.",

  // WebRTC Errors
  [ErrorCode.RTC_CONNECTION_FAILED]: "Gagal membuat koneksi video/audio.",
  [ErrorCode.RTC_ICE_CONNECTION_FAILED]:
    "Koneksi video/audio gagal. Periksa koneksi internet Anda.",
  [ErrorCode.RTC_MEDIA_ACCESS_DENIED]:
    "Akses kamera/mikrofon ditolak. Izinkan akses di browser Anda.",
  [ErrorCode.RTC_PEER_CONNECTION_FAILED]:
    "Gagal terhubung dengan peserta lain.",
  [ErrorCode.RTC_SIGNALING_ERROR]: "Terjadi kesalahan dalam koneksi signaling.",

  // LiveKit Errors
  [ErrorCode.LK_CONNECTION_FAILED]: "Gagal terhubung ke layanan video.",
  [ErrorCode.LK_TOKEN_INVALID]: "Token video tidak valid.",
  [ErrorCode.LK_ROOM_FULL]: "Ruangan meeting sudah penuh.",
  [ErrorCode.LK_PERMISSION_DENIED]:
    "Anda tidak memiliki izin untuk bergabung dalam meeting ini.",

  // Meeting Errors
  [ErrorCode.MTG_NOT_FOUND]: "Meeting tidak ditemukan.",
  [ErrorCode.MTG_ALREADY_ENDED]: "Meeting telah berakhir.",
  [ErrorCode.MTG_NOT_STARTED]: "Meeting belum dimulai.",
  [ErrorCode.MTG_ACCESS_DENIED]: "Anda tidak dapat mengakses meeting ini.",
  [ErrorCode.MTG_CREATE_FAILED]: "Gagal membuat meeting. Silakan coba lagi.",
  [ErrorCode.MTG_UPDATE_FAILED]:
    "Gagal memperbarui meeting. Silakan coba lagi.",
  [ErrorCode.MTG_DELETE_FAILED]: "Gagal menghapus meeting. Silakan coba lagi.",
  [ErrorCode.MTG_JOIN_FAILED]: "Gagal bergabung ke meeting. Silakan coba lagi.",
  [ErrorCode.MTG_LEAVE_FAILED]: "Gagal keluar dari meeting. Silakan coba lagi.",

  // Chat Errors
  [ErrorCode.CHAT_SEND_FAILED]: "Gagal mengirim pesan. Silakan coba lagi.",
  [ErrorCode.CHAT_MESSAGE_TOO_LONG]:
    "Pesan terlalu panjang. Batasi karakter pesan Anda.",
  [ErrorCode.CHAT_INVALID_CONTENT]: "Isi pesan tidak valid.",

  // User Errors
  [ErrorCode.USR_NOT_FOUND]: "Pengguna tidak ditemukan.",
  [ErrorCode.USR_ALREADY_EXISTS]: "Pengguna sudah terdaftar.",
  [ErrorCode.USR_PROFILE_UPDATE_FAILED]:
    "Gagal memperbarui profil. Silakan coba lagi.",
  [ErrorCode.USR_DELETE_FAILED]: "Gagal menghapus akun. Silakan coba lagi.",

  // System Errors
  [ErrorCode.SYS_UNKNOWN_ERROR]: "Terjadi kesalahan yang tidak diketahui.",
  [ErrorCode.SYS_BROWSER_NOT_SUPPORTED]:
    "Browser Anda tidak didukung. Gunakan browser yang lebih baru.",
  [ErrorCode.SYS_STORAGE_ACCESS_DENIED]:
    "Tidak dapat mengakses penyimpanan browser.",
  [ErrorCode.SYS_QUOTA_EXCEEDED]: "Kuota penyimpanan browser penuh.",

  // Fallback
  [ErrorCode.UNKNOWN_ERROR]: "Terjadi kesalahan. Silakan coba lagi.",
};

export const ERROR_CATEGORIES: Record<ErrorCategory, string> = {
  [ErrorCategory.NETWORK]: "Koneksi Jaringan",
  [ErrorCategory.AUTHENTICATION]: "Autentikasi",
  [ErrorCategory.AUTHORIZATION]: "Otorisasi",
  [ErrorCategory.VALIDATION]: "Validasi Data",
  [ErrorCategory.WEBSOCKET]: "Koneksi Real-time",
  [ErrorCategory.WEBRTC]: "Video/Audio Conference",
  [ErrorCategory.LIVEKIT]: "Layanan Video",
  [ErrorCategory.MEETING]: "Meeting",
  [ErrorCategory.CHAT]: "Pesan",
  [ErrorCategory.USER]: "Pengguna",
  [ErrorCategory.SYSTEM]: "Sistem",
  [ErrorCategory.UNKNOWN]: "Tidak Diketahui",
};

export const getErrorMessage = (code: ErrorCode): string => {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES[ErrorCode.UNKNOWN_ERROR];
};

export const getErrorCategoryName = (category: ErrorCategory): string => {
  return ERROR_CATEGORIES[category] || ERROR_CATEGORIES[ErrorCategory.UNKNOWN];
};

export const isRetryableError = (code: ErrorCode): boolean => {
  const retryableCodes = [
    ErrorCode.NETWORK_TIMEOUT,
    ErrorCode.NETWORK_CONNECTION_FAILED,
    ErrorCode.NETWORK_SERVER_ERROR,
    ErrorCode.WS_CONNECTION_FAILED,
    ErrorCode.WS_CONNECTION_LOST,
    ErrorCode.RTC_CONNECTION_FAILED,
    ErrorCode.RTC_ICE_CONNECTION_FAILED,
    ErrorCode.LK_CONNECTION_FAILED,
    ErrorCode.MTG_JOIN_FAILED,
    ErrorCode.CHAT_SEND_FAILED,
  ];

  return retryableCodes.includes(code);
};

export const getRetryDelay = (
  retryCount: number,
  baseDelay: number = 1000
): number => {
  const maxDelay = 30000; // 30 seconds max
  const delay = baseDelay * Math.pow(2, retryCount);
  return Math.min(delay, maxDelay);
};

export const shouldShowUserNotification = (code: ErrorCode): boolean => {
  // Some errors are handled internally and don't need user notification
  const silentErrors = [
    ErrorCode.WS_CONNECTION_LOST, // Handled by auto-reconnect
    ErrorCode.AUTH_TOKEN_EXPIRED, // Handled by auto-refresh
  ];

  return !silentErrors.includes(code);
};

export const getErrorSeverity = (
  code: ErrorCode
): "low" | "medium" | "high" | "critical" => {
  const criticalErrors = [
    ErrorCode.SYS_BROWSER_NOT_SUPPORTED,
    ErrorCode.SYS_STORAGE_ACCESS_DENIED,
  ];

  const highErrors = [
    ErrorCode.AUTH_NOT_AUTHENTICATED,
    ErrorCode.PERM_ACCESS_DENIED,
    ErrorCode.RTC_MEDIA_ACCESS_DENIED,
    ErrorCode.LK_PERMISSION_DENIED,
  ];

  const mediumErrors = [
    ErrorCode.NETWORK_OFFLINE,
    ErrorCode.NETWORK_CONNECTION_FAILED,
    ErrorCode.WS_CONNECTION_FAILED,
    ErrorCode.RTC_CONNECTION_FAILED,
  ];

  if (criticalErrors.includes(code)) return "critical";
  if (highErrors.includes(code)) return "high";
  if (mediumErrors.includes(code)) return "medium";
  return "low";
};
