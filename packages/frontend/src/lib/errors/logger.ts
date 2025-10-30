import type { AppError, ErrorLogEntry, ErrorContext } from "./types";
import { ErrorCode, ErrorCategory } from "./types";
import { getErrorSeverity } from "./messages";
import { Logger } from "../logger";

class ErrorLogger {
  private logger: Logger;

  constructor() {
    // Initialize the comprehensive logger
    this.logger = new Logger();
    this.logger.initialize();
  }

  // Log error with structured format
  logError(error: AppError, additionalContext?: Record<string, any>): void {
    this.logger.error(error.message, {
      category: error.category,
      errorCode: error.code,
      userMessage: error.userMessage,
      retryable: error.retryable,
      retryCount: error.retryCount,
      maxRetries: error.maxRetries,
      ...error.context,
      ...additionalContext,
      stackTrace: error.originalError?.stack,
    });
  }

  // Log general message
  log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    context?: Record<string, any>
  ): void {
    this.logger[level](message, context);
  }

  // Convenience methods
  debug(message: string, context?: Record<string, any>): void {
    this.logger.debug(message, context);
  }

  info(message: string, context?: Record<string, any>): void {
    this.logger.info(message, context);
  }

  warn(message: string, context?: Record<string, any>): void {
    this.logger.warn(message, context);
  }

  error(message: string, context?: Record<string, any>): void {
    this.logger.error(message, context);
  }

  // Performance logging
  logPerformance(
    operation: string,
    duration: number,
    context?: Record<string, any>
  ): void {
    this.logger.logMetric(operation, duration, {
      ...context,
    });
  }

  // User action logging
  logUserAction(action: string, context?: Record<string, any>): void {
    this.logger.logUserAction(action, undefined, context);
  }

  // Network request logging
  logNetworkRequest(
    url: string,
    method: string,
    status: number,
    duration: number,
    context?: Record<string, any>
  ): void {
    this.logger.logApiCall(url, method, status, duration, context);
  }

  // Get log statistics (delegated to comprehensive logger)
  getLogStats(): {
    total: number;
    byLevel: Record<string, number>;
    byCategory: Record<string, number>;
    recentErrors: any[];
  } {
    return this.logger.getStats();
  }

  // Export logs for debugging (delegated to comprehensive logger)
  exportLogs(): string {
    return this.logger.exportLogs();
  }

  // Clear logs (delegated to comprehensive logger)
  clearLogs(): void {
    this.logger.clearLogs();
  }

  // Update configuration (delegated to comprehensive logger)
  updateConfig(newConfig: any): void {
    this.logger.updateConfig(newConfig);
  }

  // Destroy logger (delegated to comprehensive logger)
  destroy(): void {
    this.logger.destroy();
  }
}

// Create singleton instance
export const errorLogger = new ErrorLogger();

// Export utility functions
export const logError = (error: AppError, context?: Record<string, any>) => {
  errorLogger.logError(error, context);
};

export const logUserAction = (
  action: string,
  context?: Record<string, any>
) => {
  errorLogger.logUserAction(action, context);
};

export const logPerformance = (
  operation: string,
  duration: number,
  context?: Record<string, any>
) => {
  errorLogger.logPerformance(operation, duration, context);
};

export const logNetworkRequest = (
  url: string,
  method: string,
  status: number,
  duration: number,
  context?: Record<string, any>
) => {
  errorLogger.logNetworkRequest(url, method, status, duration, context);
};
