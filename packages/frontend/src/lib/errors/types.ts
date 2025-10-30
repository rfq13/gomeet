// Centralized Error Types and Categories

export enum ErrorCategory {
  NETWORK = "NETWORK",
  AUTHENTICATION = "AUTHENTICATION",
  AUTHORIZATION = "AUTHORIZATION",
  VALIDATION = "VALIDATION",
  WEBSOCKET = "WEBSOCKET",
  WEBRTC = "WEBRTC",
  LIVEKIT = "LIVEKIT",
  MEETING = "MEETING",
  CHAT = "CHAT",
  USER = "USER",
  SYSTEM = "SYSTEM",
  UNKNOWN = "UNKNOWN",
}

export enum ErrorCode {
  // Network Errors (NET_xxx)
  NETWORK_OFFLINE = "NET_001",
  NETWORK_TIMEOUT = "NET_002",
  NETWORK_CONNECTION_FAILED = "NET_003",
  NETWORK_SERVER_ERROR = "NET_004",
  NETWORK_RATE_LIMIT = "NET_005",

  // Authentication Errors (AUTH_xxx)
  AUTH_INVALID_CREDENTIALS = "AUTH_001",
  AUTH_TOKEN_EXPIRED = "AUTH_002",
  AUTH_TOKEN_INVALID = "AUTH_003",
  AUTH_NOT_AUTHENTICATED = "AUTH_004",
  AUTH_SESSION_EXPIRED = "AUTH_005",
  AUTH_LOGIN_REQUIRED = "AUTH_006",

  // Authorization Errors (PERM_xxx)
  PERM_ACCESS_DENIED = "PERM_001",
  PERM_INSUFFICIENT_PERMISSIONS = "PERM_002",
  PERM_RESOURCE_FORBIDDEN = "PERM_003",

  // Validation Errors (VAL_xxx)
  VAL_INVALID_INPUT = "VAL_001",
  VAL_REQUIRED_FIELD_MISSING = "VAL_002",
  VAL_INVALID_FORMAT = "VAL_003",
  VAL_INVALID_LENGTH = "VAL_004",
  VAL_INVALID_EMAIL = "VAL_005",
  VAL_PASSWORD_TOO_WEAK = "VAL_006",

  // WebSocket Errors (WS_xxx)
  WS_CONNECTION_FAILED = "WS_001",
  WS_CONNECTION_LOST = "WS_002",
  WS_RECONNECT_FAILED = "WS_003",
  WS_MESSAGE_PARSE_ERROR = "WS_004",

  // WebRTC Errors (RTC_xxx)
  RTC_CONNECTION_FAILED = "RTC_001",
  RTC_ICE_CONNECTION_FAILED = "RTC_002",
  RTC_MEDIA_ACCESS_DENIED = "RTC_003",
  RTC_PEER_CONNECTION_FAILED = "RTC_004",
  RTC_SIGNALING_ERROR = "RTC_005",

  // LiveKit Errors (LK_xxx)
  LK_CONNECTION_FAILED = "LK_001",
  LK_TOKEN_INVALID = "LK_002",
  LK_ROOM_FULL = "LK_003",
  LK_PERMISSION_DENIED = "LK_004",

  // Meeting Errors (MTG_xxx)
  MTG_NOT_FOUND = "MTG_001",
  MTG_ALREADY_ENDED = "MTG_002",
  MTG_NOT_STARTED = "MTG_003",
  MTG_ACCESS_DENIED = "MTG_004",
  MTG_CREATE_FAILED = "MTG_005",
  MTG_UPDATE_FAILED = "MTG_006",
  MTG_DELETE_FAILED = "MTG_007",
  MTG_JOIN_FAILED = "MTG_008",
  MTG_LEAVE_FAILED = "MTG_009",

  // Chat Errors (CHAT_xxx)
  CHAT_SEND_FAILED = "CHAT_001",
  CHAT_MESSAGE_TOO_LONG = "CHAT_002",
  CHAT_INVALID_CONTENT = "CHAT_003",

  // User Errors (USR_xxx)
  USR_NOT_FOUND = "USR_001",
  USR_ALREADY_EXISTS = "USR_002",
  USR_PROFILE_UPDATE_FAILED = "USR_003",
  USR_DELETE_FAILED = "USR_004",

  // System Errors (SYS_xxx)
  SYS_UNKNOWN_ERROR = "SYS_001",
  SYS_BROWSER_NOT_SUPPORTED = "SYS_002",
  SYS_STORAGE_ACCESS_DENIED = "SYS_003",
  SYS_QUOTA_EXCEEDED = "SYS_004",

  // Fallback
  UNKNOWN_ERROR = "UNKNOWN_001",
}

export interface ErrorContext {
  component?: string;
  action?: string;
  userId?: string;
  meetingId?: string;
  sessionId?: string;
  timestamp?: string;
  additionalData?: Record<string, any>;
}

export interface AppError {
  code: ErrorCode;
  category: ErrorCategory;
  message: string;
  userMessage: string;
  originalError?: Error | any;
  context?: ErrorContext;
  retryable: boolean;
  retryCount?: number;
  maxRetries?: number;
  timestamp: string;
  id: string;
}

export interface ErrorLogEntry {
  id: string;
  error: AppError;
  userAgent: string;
  url: string;
  stackTrace?: string;
  resolved: boolean;
  resolvedAt?: string;
}

export interface ErrorState {
  errors: AppError[];
  currentError: AppError | null;
  errorHistory: ErrorLogEntry[];
  isLoading: boolean;
  retryQueue: AppError[];
}

export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier: number;
  maxDelay: number;
}

export interface ErrorNotification {
  id: string;
  type: "error" | "warning" | "info";
  title: string;
  message: string;
  duration?: number;
  persistent?: boolean;
  actions?: Array<{
    label: string;
    action: () => void;
    variant?: "primary" | "secondary";
  }>;
}
