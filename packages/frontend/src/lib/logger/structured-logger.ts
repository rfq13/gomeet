import type {
  LogEntry,
  LoggerConfig,
  RemoteLogPayload,
  LoggerError,
} from "./types";
import { ConfigurationError } from "./types";

export class StructuredLogger {
  private config: LoggerConfig;
  private logBuffer: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isOnline = true;
  private context: Record<string, any> = {};
  private eventListeners: Map<string, Function[]> = new Map();

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      enableConsoleLogging: true,
      enableRemoteLogging: false,
      maxLogEntries: 1000,
      logLevels: ["warn", "error"],
      enableStackTrace: true,
      enablePerformanceLogging: true,
      enableUserActionLogging: true,
      enableNetworkLogging: true,
      enableWebRTCLogging: true,
      samplingRate: 1.0,
      ...config,
    };

    this.initializeEventListeners();
    this.startFlushTimer();
  }

  private initializeEventListeners(): void {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        this.isOnline = true;
        this.flushBuffer();
      });

      window.addEventListener("offline", () => {
        this.isOnline = false;
      });

      // Log page visibility changes
      document.addEventListener("visibilitychange", () => {
        this.debug("Page visibility changed", {
          hidden: document.hidden,
          visibilityState: document.visibilityState,
        });
      });

      // Log page unload
      window.addEventListener("beforeunload", () => {
        this.info("Page unloading");
        this.flushBuffer();
      });
    }
  }

  private shouldLog(level: "debug" | "info" | "warn" | "error"): boolean {
    // Check if level is enabled
    if (!this.config.logLevels.includes(level)) {
      return false;
    }

    // Apply sampling rate
    if (this.config.samplingRate && this.config.samplingRate < 1.0) {
      return Math.random() < this.config.samplingRate;
    }

    return true;
  }

  private createLogEntry(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    additionalContext?: Record<string, any>
  ): LogEntry {
    const entry: LogEntry = {
      id: this.generateLogId(),
      timestamp: new Date().toISOString(),
      level,
      message,
      context: {
        ...this.context,
        ...additionalContext,
      },
      userAgent:
        typeof window !== "undefined" ? window.navigator.userAgent : undefined,
      url: typeof window !== "undefined" ? window.location.href : undefined,
      userId: this.context.userId,
      sessionId: this.context.sessionId,
      requestId: this.context.requestId,
    };

    // Add stack trace for errors if enabled
    if (level === "error" && this.config.enableStackTrace) {
      entry.stackTrace = new Error().stack;
    }

    return entry;
  }

  private addLogEntry(entry: LogEntry): void {
    // Add to buffer
    this.logBuffer.push(entry);

    // Maintain buffer size
    if (this.logBuffer.length > this.config.maxLogEntries) {
      this.logBuffer = this.logBuffer.slice(-this.config.maxLogEntries);
    }

    // Console logging
    if (this.config.enableConsoleLogging) {
      this.logToConsole(entry);
    }

    // Emit event
    this.emit("log-added", entry);

    // Remote logging
    if (this.config.enableRemoteLogging && this.isOnline) {
      this.scheduleFlush();
    }

    // Special handling for errors
    if (entry.level === "error") {
      this.emit("error-logged", entry);
    }
  }

  private logToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const prefix = `[${timestamp}] [${entry.level.toUpperCase()}]`;

    const style = this.getConsoleStyle(entry.level);

    if (entry.context && Object.keys(entry.context).length > 0) {
      console.groupCollapsed(
        `%c${prefix} ${entry.message}`,
        style,
        entry.context
      );

      if (entry.stackTrace) {
        console.log("Stack Trace:", entry.stackTrace);
      }

      console.groupEnd();
    } else {
      console.log(`%c${prefix} ${entry.message}`, style);
    }
  }

  private getConsoleStyle(level: string): string {
    switch (level) {
      case "error":
        return "color: #ef4444; font-weight: bold; background: #fef2f2; padding: 2px 4px; border-radius: 2px;";
      case "warn":
        return "color: #f59e0b; font-weight: bold; background: #fffbeb; padding: 2px 4px; border-radius: 2px;";
      case "info":
        return "color: #3b82f6; font-weight: bold; background: #eff6ff; padding: 2px 4px; border-radius: 2px;";
      case "debug":
        return "color: #6b7280; font-weight: normal; background: #f9fafb; padding: 2px 4px; border-radius: 2px;";
      default:
        return "color: #374151; font-weight: normal;";
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushBuffer();
    }, 1000); // Flush after 1 second
  }

  private startFlushTimer(): void {
    setInterval(() => {
      if (this.config.enableRemoteLogging && this.logBuffer.length > 0) {
        this.flushBuffer();
      }
    }, 30000); // Flush every 30 seconds
  }

  private async flushBuffer(): Promise<void> {
    if (
      !this.config.enableRemoteLogging ||
      !this.config.remoteEndpoint ||
      !this.isOnline
    ) {
      return;
    }

    if (this.logBuffer.length === 0) {
      return;
    }

    const logsToSend = [...this.logBuffer];
    this.logBuffer = [];

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    try {
      await this.sendLogsToRemote(logsToSend);
    } catch (error) {
      // Re-add logs to buffer on failure
      this.logBuffer.unshift(...logsToSend);
      console.error("Failed to send logs to remote endpoint:", error);
    }
  }

  private async sendLogsToRemote(logs: LogEntry[]): Promise<void> {
    if (!this.config.remoteEndpoint) {
      throw new ConfigurationError("Remote endpoint not configured");
    }

    const payload: RemoteLogPayload = {
      logs,
      metadata: {
        timestamp: new Date().toISOString(),
        userAgent:
          typeof window !== "undefined"
            ? window.navigator.userAgent
            : "Unknown",
        url: typeof window !== "undefined" ? window.location.href : "Unknown",
        userId: this.context.userId,
        sessionId: this.context.sessionId,
        version: process.env.VERSION || "1.0.0",
        environment: process.env.NODE_ENV || "development",
      },
    };

    const response = await fetch(this.config.remoteEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to send logs: ${response.status} ${response.statusText}`
      );
    }
  }

  // Public logging methods
  debug(message: string, context?: Record<string, any>): void {
    if (!this.shouldLog("debug")) return;

    const entry = this.createLogEntry("debug", message, context);
    this.addLogEntry(entry);
  }

  info(message: string, context?: Record<string, any>): void {
    if (!this.shouldLog("info")) return;

    const entry = this.createLogEntry("info", message, context);
    this.addLogEntry(entry);
  }

  warn(message: string, context?: Record<string, any>): void {
    if (!this.shouldLog("warn")) return;

    const entry = this.createLogEntry("warn", message, context);
    this.addLogEntry(entry);
  }

  error(message: string, context?: Record<string, any>): void {
    if (!this.shouldLog("error")) return;

    const entry = this.createLogEntry("error", message, context);
    this.addLogEntry(entry);
  }

  logError(error: Error, context?: Record<string, any>): void {
    if (!this.shouldLog("error")) return;

    const entry = this.createLogEntry("error", error.message, {
      ...context,
      errorName: error.name,
      errorMessage: error.message,
      stackTrace: error.stack,
    });

    this.addLogEntry(entry);
  }

  logErrorWithStack(error: Error, context?: Record<string, any>): void {
    if (!this.shouldLog("error")) return;

    const entry = this.createLogEntry("error", error.message, {
      ...context,
      errorName: error.name,
      errorMessage: error.message,
      stackTrace: error.stack,
    });

    entry.stackTrace = error.stack;
    this.addLogEntry(entry);
  }

  // Context management
  setContext(keyOrObject: string | Record<string, any>, value?: any): void {
    if (typeof keyOrObject === "string" && value !== undefined) {
      this.context[keyOrObject] = value;
    } else if (typeof keyOrObject === "object") {
      this.context = { ...this.context, ...keyOrObject };
    }
  }

  getContext(key?: string): any {
    if (key) {
      return this.context[key];
    }
    return { ...this.context };
  }

  clearContext(): void {
    this.context = {};
  }

  // Event management
  on(event: string, callback: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  off(event: string, callback: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => callback(data));
    }
  }

  // Utility methods
  private generateLogId(): string {
    return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getLogs(filter?: {
    levels?: ("debug" | "info" | "warn" | "error")[];
    categories?: string[];
    limit?: number;
    offset?: number;
  }): LogEntry[] {
    let logs = [...this.logBuffer];

    if (filter) {
      if (filter.levels && filter.levels.length > 0) {
        logs = logs.filter((log) => filter.levels!.includes(log.level));
      }

      if (filter.categories && filter.categories.length > 0) {
        logs = logs.filter(
          (log) => log.category && filter.categories!.includes(log.category)
        );
      }

      if (filter.offset) {
        logs = logs.slice(filter.offset);
      }

      if (filter.limit) {
        logs = logs.slice(0, filter.limit);
      }
    }

    return logs;
  }

  exportLogs(
    format: "json" | "csv" = "json",
    filter?: {
      levels?: ("debug" | "info" | "warn" | "error")[];
      categories?: string[];
    }
  ): string {
    const logs = this.getLogs(filter);

    if (format === "csv") {
      const headers = ["timestamp", "level", "message", "category", "context"];
      const csvRows = [headers.join(",")];

      logs.forEach((log) => {
        const row = [
          log.timestamp,
          log.level,
          `"${log.message.replace(/"/g, '""')}"`,
          log.category || "",
          `"${JSON.stringify(log.context || {}).replace(/"/g, '""')}"`,
        ];
        csvRows.push(row.join(","));
      });

      return csvRows.join("\n");
    }

    return JSON.stringify(logs, null, 2);
  }

  clearLogs(): void {
    this.logBuffer = [];
    this.emit("log-cleared", undefined);
  }

  getStats() {
    const byLevel: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const byComponent: Record<string, number> = {};
    const recentErrors = this.logBuffer
      .filter((entry) => entry.level === "error")
      .slice(-10);

    this.logBuffer.forEach((entry) => {
      byLevel[entry.level] = (byLevel[entry.level] || 0) + 1;

      if (entry.category) {
        byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
      }

      if (entry.context?.component) {
        byComponent[entry.context.component] =
          (byComponent[entry.context.component] || 0) + 1;
      }
    });

    return {
      total: this.logBuffer.length,
      byLevel,
      byCategory,
      byComponent,
      recentErrors,
      oldestLog:
        this.logBuffer.length > 0
          ? new Date(this.logBuffer[0].timestamp)
          : undefined,
      newestLog:
        this.logBuffer.length > 0
          ? new Date(this.logBuffer[this.logBuffer.length - 1].timestamp)
          : undefined,
    };
  }

  updateConfig(newConfig: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit("config-updated", this.config);
  }

  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  destroy(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining logs
    this.flushBuffer();

    // Clear event listeners
    this.eventListeners.clear();
  }
}
