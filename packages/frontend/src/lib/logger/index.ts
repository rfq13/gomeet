import type { LoggerConfig, LogEntry, LogLevelConfig } from "./types";
import { StructuredLogger } from "./structured-logger";
import { UserActionLogger } from "./user-action-logger";
import { PerformanceLogger } from "./performance-logger";
import { NetworkLogger } from "./network-logger";
import { WebRTCLogger } from "./webrtc-logger";

export class Logger {
  private structuredLogger: StructuredLogger;
  private userActionLogger: UserActionLogger;
  private performanceLogger: PerformanceLogger;
  private networkLogger: NetworkLogger;
  private webrtcLogger: WebRTCLogger;
  private isInitialized = false;

  constructor(config?: Partial<LoggerConfig>) {
    const defaultConfig: LoggerConfig = {
      enableConsoleLogging: true,
      enableRemoteLogging: false,
      maxLogEntries: 1000,
      logLevels: ["info", "warn", "error"],
      enableStackTrace: true,
      enablePerformanceLogging: true,
      enableUserActionLogging: true,
      enableNetworkLogging: true,
      enableWebRTCLogging: true,
      samplingRate: 1.0,
      ...config,
    };

    this.structuredLogger = new StructuredLogger(defaultConfig);
    this.userActionLogger = new UserActionLogger(this.structuredLogger);
    this.performanceLogger = new PerformanceLogger(this.structuredLogger);
    this.networkLogger = new NetworkLogger(this.structuredLogger);
    this.webrtcLogger = new WebRTCLogger(this.structuredLogger);
  }

  // Initialize all loggers
  initialize(context?: {
    userId?: string;
    sessionId?: string;
    requestId?: string;
  }): void {
    if (this.isInitialized) {
      return;
    }

    // Set initial context
    if (context) {
      this.setContext(context);
    }

    // Initialize network logger to intercept requests
    if (this.structuredLogger.getConfig().enableNetworkLogging) {
      this.networkLogger.initialize();
    }

    // Initialize user action logger to track DOM events
    if (this.structuredLogger.getConfig().enableUserActionLogging) {
      this.userActionLogger.initialize();
    }

    this.isInitialized = true;
    this.info("Logger initialized", {
      category: "system",
      operation: "logger_init",
      context: {
        config: this.getConfig(),
        userAgent: navigator.userAgent,
        url: window.location.href,
      },
    });
  }

  // Cleanup all loggers
  destroy(): void {
    if (!this.isInitialized) {
      return;
    }

    this.networkLogger.destroy();
    this.userActionLogger.destroy();
    this.webrtcLogger.destroy();
    this.structuredLogger.destroy();
    this.isInitialized = false;
  }

  // Basic logging methods
  debug(message: string, context?: Record<string, any>): void {
    this.structuredLogger.debug(message, context);
  }

  info(message: string, context?: Record<string, any>): void {
    this.structuredLogger.info(message, context);
  }

  warn(message: string, context?: Record<string, any>): void {
    this.structuredLogger.warn(message, context);
  }

  error(message: string, context?: Record<string, any>): void {
    this.structuredLogger.error(message, context);
  }

  // Context management
  setContext(context: Record<string, any>): void {
    this.structuredLogger.setContext(context);
  }

  getContext(key?: string): any {
    return this.structuredLogger.getContext(key);
  }

  clearContext(): void {
    this.structuredLogger.clearContext();
  }

  // Performance logging
  startTimer(operation: string): () => void {
    return this.performanceLogger.startTimer(operation);
  }

  logMetric(
    operation: string,
    duration: number,
    context?: Record<string, any>
  ): void {
    this.performanceLogger.logMetric(operation, duration, context);
  }

  logPageLoad(context?: Record<string, any>): void {
    this.performanceLogger.logPageLoad(context);
  }

  logResourceTiming(context?: Record<string, any>): void {
    // Resource timing is automatically logged by performance logger initialization
  }

  logNetworkPerformance(context?: Record<string, any>): void {
    this.performanceLogger.logNetworkPerformance(context);
  }

  // User action logging
  logUserAction(
    action: string,
    element?: string,
    additionalContext?: Record<string, any>
  ): void {
    this.userActionLogger.logUserAction(action, element, additionalContext);
  }

  logFormInteraction(
    formId: string,
    action: string,
    formData?: Record<string, any>
  ): void {
    this.userActionLogger.logFormInteraction(formId, action, formData);
  }

  logNavigation(from: string, to: string, method?: string): void {
    this.userActionLogger.logNavigation(from, to, method);
  }

  // Network logging
  logApiCall(
    endpoint: string,
    method: string,
    statusCode: number,
    duration: number,
    additionalContext?: Record<string, any>
  ): void {
    this.networkLogger.logApiCall(
      endpoint,
      method,
      statusCode,
      duration,
      additionalContext
    );
  }

  logWebSocketEvent(
    event: "connect" | "disconnect" | "message" | "error",
    url: string,
    additionalContext?: Record<string, any>
  ): void {
    this.networkLogger.logWebSocketEvent(event, url, additionalContext);
  }

  logConnectionQuality(
    url: string,
    metrics: {
      latency: number;
      bandwidth?: number;
      packetLoss?: number;
      jitter?: number;
    }
  ): void {
    this.networkLogger.logConnectionQuality(url, metrics);
  }

  // WebRTC logging
  logConnectionCreated(
    connectionId: string,
    meetingId?: string,
    peerId?: string
  ): void {
    this.webrtcLogger.logConnectionCreated(connectionId, meetingId, peerId);
  }

  logConnectionStateChange(
    connectionId: string,
    oldState: string,
    newState: string,
    meetingId?: string,
    peerId?: string
  ): void {
    this.webrtcLogger.logConnectionStateChange(
      connectionId,
      oldState,
      newState,
      meetingId,
      peerId
    );
  }

  logSignalingEvent(
    connectionId: string,
    eventType: string,
    data?: any,
    meetingId?: string,
    peerId?: string
  ): void {
    this.webrtcLogger.logSignalingEvent(
      connectionId,
      eventType,
      data,
      meetingId,
      peerId
    );
  }

  logMediaTrackAdded(
    connectionId: string,
    trackKind: "audio" | "video",
    trackId: string,
    meetingId?: string,
    peerId?: string
  ): void {
    this.webrtcLogger.logMediaTrackAdded(
      connectionId,
      trackKind,
      trackId,
      meetingId,
      peerId
    );
  }

  logMediaTrackRemoved(
    connectionId: string,
    trackKind: "audio" | "video",
    trackId: string,
    meetingId?: string,
    peerId?: string
  ): void {
    this.webrtcLogger.logMediaTrackRemoved(
      connectionId,
      trackKind,
      trackId,
      meetingId,
      peerId
    );
  }

  logMediaStateChange(
    connectionId: string,
    type: "audio" | "video",
    enabled: boolean,
    meetingId?: string,
    peerId?: string
  ): void {
    this.webrtcLogger.logMediaStateChange(
      connectionId,
      type,
      enabled,
      meetingId,
      peerId
    );
  }

  startWebRTCStatsMonitoring(
    connectionId: string,
    peerConnection: RTCPeerConnection,
    meetingId?: string,
    peerId?: string
  ): void {
    this.webrtcLogger.startStatsMonitoring(
      connectionId,
      peerConnection,
      meetingId,
      peerId
    );
  }

  stopWebRTCStatsMonitoring(connectionId: string): void {
    this.webrtcLogger.stopStatsMonitoring(connectionId);
  }

  logMeetingJoined(meetingId: string, userId?: string): void {
    this.webrtcLogger.logMeetingJoined(meetingId, userId);
  }

  logMeetingLeft(meetingId: string, reason?: string): void {
    this.webrtcLogger.logMeetingLeft(meetingId, reason);
  }

  // Configuration and management
  updateConfig(config: Partial<LoggerConfig>): void {
    this.structuredLogger.updateConfig(config);
  }

  getConfig(): LoggerConfig {
    return this.structuredLogger.getConfig();
  }

  // Log retrieval and filtering
  getLogs(filter?: {
    levels?: ("debug" | "info" | "warn" | "error")[];
    categories?: string[];
    limit?: number;
    offset?: number;
  }): LogEntry[] {
    return this.structuredLogger.getLogs(filter);
  }

  clearLogs(): void {
    this.structuredLogger.clearLogs();
  }

  // Export logs
  exportLogs(
    format: "json" | "csv" = "json",
    filter?: {
      levels?: ("debug" | "info" | "warn" | "error")[];
      categories?: string[];
    }
  ): string {
    return this.structuredLogger.exportLogs(format, filter);
  }

  // Statistics
  getStats(): {
    total: number;
    byLevel: Record<string, number>;
    byCategory: Record<string, number>;
    recentErrors: LogEntry[];
  } {
    return this.structuredLogger.getStats();
  }

  // Event handling
  on<K extends keyof import("./types").LoggerEventMap>(
    event: K,
    callback: (data: import("./types").LoggerEventMap[K]) => void
  ): void {
    this.structuredLogger.on(event, callback);
  }

  off<K extends keyof import("./types").LoggerEventMap>(
    event: K,
    callback: (data: import("./types").LoggerEventMap[K]) => void
  ): void {
    this.structuredLogger.off(event, callback);
  }

  // Utility methods
  generateRequestId(): string {
    return this.structuredLogger.generateRequestId();
  }

  generateSessionId(): string {
    return this.structuredLogger.generateSessionId();
  }

  // Backward compatibility methods
  log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    context?: Record<string, any>
  ): void {
    this.structuredLogger[level](message, context);
  }

  // Debug utilities
  getWebRTCConnectionInfo(connectionId: string): {
    state: string | undefined;
    isMonitoring: boolean;
  } {
    return this.webrtcLogger.getConnectionInfo(connectionId);
  }
}

// Create and export singleton instance
export const logger = new Logger();

// Export types and classes for advanced usage
export type { LoggerConfig, LogEntry, LogLevelConfig } from "./types";
export { StructuredLogger } from "./structured-logger";
export { UserActionLogger } from "./user-action-logger";
export { PerformanceLogger } from "./performance-logger";
export { NetworkLogger } from "./network-logger";
export { WebRTCLogger } from "./webrtc-logger";
export {
  LoggerError,
  ConfigurationError,
  NetworkError,
  ValidationError,
} from "./types";

// Default export
export default logger;
