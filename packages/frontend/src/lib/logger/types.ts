export interface LogEntry {
  id: string;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  category?: string;
  context?: Record<string, any>;
  stackTrace?: string;
  userAgent?: string;
  url?: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  component?: string;
  operation?: string;
  duration?: number;
}

export interface LoggerConfig {
  enableConsoleLogging: boolean;
  enableRemoteLogging: boolean;
  remoteEndpoint?: string;
  maxLogEntries: number;
  logLevels: ("debug" | "info" | "warn" | "error")[];
  enableStackTrace: boolean;
  enablePerformanceLogging: boolean;
  enableUserActionLogging: boolean;
  enableNetworkLogging: boolean;
  enableWebRTCLogging: boolean;
  samplingRate?: number; // 0.0 to 1.0 for sampling logs
}

export interface UserActionContext {
  action: string;
  element?: string;
  elementType?: string;
  page?: string;
  timestamp: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export interface PerformanceContext {
  operation: string;
  duration: number;
  startTime: number;
  endTime: number;
  type: "navigation" | "resource" | "paint" | "custom";
  metadata?: Record<string, any>;
}

export interface NetworkContext {
  url: string;
  method: string;
  statusCode?: number;
  status?: number;
  duration?: number;
  requestSize?: number;
  responseSize?: number;
  cacheHit?: boolean;
  cached?: boolean;
  protocol?: string;
  timestamp?: string;
  error?: string;
  retryCount?: number;
}

export interface WebRTCContext {
  meetingId?: string;
  peerId?: string;
  eventType: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface WebRTCStats {
  connectionState?: string;
  iceConnectionState?: string;
  iceGatheringState?: string;
  signalingState?: string;
  bytesReceived?: number;
  bytesSent?: number;
  packetsLost?: number;
  roundTripTime?: number;
  jitter?: number;
  audioLevel?: number;
  videoWidth?: number;
  videoHeight?: number;
  frameRate?: number;
}

export interface LogLevelConfig {
  debug: boolean;
  info: boolean;
  warn: boolean;
  error: boolean;
}

export interface LogFilter {
  levels?: ("debug" | "info" | "warn" | "error")[];
  categories?: string[];
  components?: string[];
  timeRange?: {
    start: Date;
    end: Date;
  };
  userId?: string;
  sessionId?: string;
  search?: string;
}

export interface LogExportOptions {
  format: "json" | "csv" | "txt";
  includeStackTrace?: boolean;
  filter?: LogFilter;
  maxEntries?: number;
}

export interface LoggerStats {
  total: number;
  byLevel: Record<string, number>;
  byCategory: Record<string, number>;
  byComponent: Record<string, number>;
  recentErrors: LogEntry[];
  oldestLog?: Date;
  newestLog?: Date;
  memoryUsage?: number;
}

export interface RemoteLogPayload {
  logs: LogEntry[];
  metadata: {
    timestamp: string;
    userAgent: string;
    url: string;
    userId?: string;
    sessionId?: string;
    version?: string;
    environment?: string;
  };
}

export interface LoggerEventMap {
  "log-added": LogEntry;
  "log-cleared": void;
  "config-updated": LoggerConfig;
  "error-logged": LogEntry;
  "performance-threshold-exceeded": PerformanceContext;
  "network-error": NetworkContext;
  "webrtc-error": WebRTCContext;
}

// Error types for better error handling
export class LoggerError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = "LoggerError";
  }
}

export class ConfigurationError extends LoggerError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, "CONFIG_ERROR", context);
    this.name = "ConfigurationError";
  }
}

export class NetworkError extends LoggerError {
  constructor(
    message: string,
    public status?: number,
    context?: Record<string, any>
  ) {
    super(message, "NETWORK_ERROR", context);
    this.name = "NetworkError";
  }
}

export class ValidationError extends LoggerError {
  constructor(
    message: string,
    public field?: string,
    context?: Record<string, any>
  ) {
    super(message, "VALIDATION_ERROR", context);
    this.name = "ValidationError";
  }
}
