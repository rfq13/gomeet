import { errorStore } from "$lib/stores/error.store";
import { ErrorCode, ErrorCategory } from "$lib/errors/types";
import { getRetryDelay, isRetryableError } from "$lib/errors/messages";
import { logError, logPerformance } from "./logger";
import type { AppError, RetryConfig } from "./types";

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: any, attempt: number) => boolean;
  onRetry?: (attempt: number, error: any) => void;
  onSuccess?: (attempt: number) => void;
  onFailed?: (lastError: any) => void;
}

export interface RetryableFunction<T = any> {
  (...args: any[]): Promise<T>;
}

class RetryManager {
  private activeRetries = new Map<string, AbortController>();
  private defaultConfig: Required<RetryOptions>;

  constructor() {
    this.defaultConfig = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      shouldRetry: (error, attempt) => {
        // Default retry logic
        if (attempt >= this.defaultConfig.maxRetries) {
          return false;
        }

        // Check if error is retryable
        if (error.code && isRetryableError(error.code)) {
          return true;
        }

        // Network errors are generally retryable
        if (error.name === "TypeError" || error.message.includes("network")) {
          return true;
        }

        // HTTP status codes that are retryable
        if (
          error.status >= 500 ||
          error.status === 408 ||
          error.status === 429
        ) {
          return true;
        }

        return false;
      },
      onRetry: (attempt, error) => {
        console.log(`Retry attempt ${attempt} for error:`, error.message);
      },
      onSuccess: (attempt) => {
        console.log(`Operation succeeded after ${attempt} attempts`);
      },
      onFailed: (lastError) => {
        console.error("All retry attempts failed:", lastError);
      },
    };
  }

  // Execute function with retry logic
  async execute<T>(
    fn: RetryableFunction<T>,
    options: RetryOptions = {},
    ...args: any[]
  ): Promise<T> {
    const config = { ...this.defaultConfig, ...options };
    const retryId = this.generateRetryId();

    let lastError: any;
    let attempt = 0;

    while (attempt <= config.maxRetries) {
      try {
        const startTime = Date.now();

        // Create abort controller for this attempt
        const controller = new AbortController();
        this.activeRetries.set(retryId, controller);

        // Execute the function
        const result = await fn(...args);

        // Clean up
        this.activeRetries.delete(retryId);

        // Log success
        const duration = Date.now() - startTime;
        logPerformance("retry-operation", duration, {
          attempt,
          success: true,
          retryId,
        });

        if (attempt > 0 && config.onSuccess) {
          config.onSuccess(attempt);
        }

        return result;
      } catch (error) {
        lastError = error;
        attempt++;

        // Clean up
        this.activeRetries.delete(retryId);

        // Log error
        logError(
          errorStore.createError(
            this.getErrorCode(error),
            this.getErrorCategory(error),
            (error as Error).message || "Unknown error",
            error,
            { attempt, retryId } as any
          )
        );

        // Check if we should retry
        if (
          attempt <= config.maxRetries &&
          config.shouldRetry(error, attempt)
        ) {
          // Calculate delay
          const delay = Math.min(
            config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1),
            config.maxDelay
          );

          // Call retry callback
          if (config.onRetry) {
            config.onRetry(attempt, error);
          }

          // Wait before retry
          await this.delay(delay);
        } else {
          // No more retries
          break;
        }
      }
    }

    // All retries failed
    if (config.onFailed) {
      config.onFailed(lastError);
    }

    throw lastError;
  }

  // Execute with exponential backoff
  async executeWithBackoff<T>(
    fn: RetryableFunction<T>,
    options: RetryOptions = {},
    ...args: any[]
  ): Promise<T> {
    return this.execute(
      fn,
      {
        backoffMultiplier: 2,
        ...options,
      },
      ...args
    );
  }

  // Execute with linear backoff
  async executeWithLinearBackoff<T>(
    fn: RetryableFunction<T>,
    options: RetryOptions = {},
    ...args: any[]
  ): Promise<T> {
    return this.execute(
      fn,
      {
        backoffMultiplier: 1,
        ...options,
      },
      ...args
    );
  }

  // Execute with fixed delay
  async executeWithFixedDelay<T>(
    fn: RetryableFunction<T>,
    delay: number,
    options: RetryOptions = {},
    ...args: any[]
  ): Promise<T> {
    return this.execute(
      fn,
      {
        baseDelay: delay,
        backoffMultiplier: 1,
        ...options,
      },
      ...args
    );
  }

  // Cancel active retry
  cancelRetry(retryId: string): boolean {
    const controller = this.activeRetries.get(retryId);
    if (controller) {
      controller.abort();
      this.activeRetries.delete(retryId);
      return true;
    }
    return false;
  }

  // Cancel all active retries
  cancelAllRetries(): void {
    this.activeRetries.forEach((controller) => {
      controller.abort();
    });
    this.activeRetries.clear();
  }

  // Get active retry count
  getActiveRetryCount(): number {
    return this.activeRetries.size;
  }

  // Check if retry is active
  isRetryActive(retryId: string): boolean {
    return this.activeRetries.has(retryId);
  }

  // Generate retry ID
  private generateRetryId(): string {
    return `retry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Delay helper
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Get error code from error
  private getErrorCode(error: any): ErrorCode {
    if (error.code) {
      return error.code;
    }

    // Map common error types to error codes
    if (error.name === "TypeError" || error.message.includes("network")) {
      return ErrorCode.NETWORK_CONNECTION_FAILED;
    }

    if (error.status === 401) {
      return ErrorCode.AUTH_NOT_AUTHENTICATED;
    }

    if (error.status === 403) {
      return ErrorCode.PERM_ACCESS_DENIED;
    }

    if (error.status === 404) {
      return ErrorCode.MTG_NOT_FOUND;
    }

    if (error.status === 429) {
      return ErrorCode.NETWORK_RATE_LIMIT;
    }

    if (error.status >= 500) {
      return ErrorCode.NETWORK_SERVER_ERROR;
    }

    return ErrorCode.UNKNOWN_ERROR;
  }

  // Get error category from error
  private getErrorCategory(error: any): ErrorCategory {
    if (error.category) {
      return error.category;
    }

    const code = this.getErrorCode(error);

    // Map error codes to categories
    if (code.toString().startsWith("NET_")) {
      return ErrorCategory.NETWORK;
    }

    if (code.toString().startsWith("AUTH_")) {
      return ErrorCategory.AUTHENTICATION;
    }

    if (code.toString().startsWith("PERM_")) {
      return ErrorCategory.AUTHORIZATION;
    }

    if (code.toString().startsWith("VAL_")) {
      return ErrorCategory.VALIDATION;
    }

    if (code.toString().startsWith("WS_")) {
      return ErrorCategory.WEBSOCKET;
    }

    if (code.toString().startsWith("RTC_")) {
      return ErrorCategory.WEBRTC;
    }

    if (code.toString().startsWith("LK_")) {
      return ErrorCategory.LIVEKIT;
    }

    if (code.toString().startsWith("MTG_")) {
      return ErrorCategory.MEETING;
    }

    if (code.toString().startsWith("CHAT_")) {
      return ErrorCategory.CHAT;
    }

    if (code.toString().startsWith("USR_")) {
      return ErrorCategory.USER;
    }

    return ErrorCategory.UNKNOWN;
  }
}

// Create singleton instance
export const retryManager = new RetryManager();

// Convenience functions for common retry patterns
export const withRetry = <T>(
  fn: RetryableFunction<T>,
  options?: RetryOptions
) => {
  return (...args: any[]) => retryManager.execute(fn, options, ...args);
};

export const withExponentialBackoff = <T>(
  fn: RetryableFunction<T>,
  options?: RetryOptions
) => {
  return (...args: any[]) =>
    retryManager.executeWithBackoff(fn, options, ...args);
};

export const withLinearBackoff = <T>(
  fn: RetryableFunction<T>,
  options?: RetryOptions
) => {
  return (...args: any[]) =>
    retryManager.executeWithLinearBackoff(fn, options, ...args);
};

export const withFixedDelay = <T>(
  fn: RetryableFunction<T>,
  delay: number,
  options?: RetryOptions
) => {
  return (...args: any[]) =>
    retryManager.executeWithFixedDelay(fn, delay, options, ...args);
};

// Network-specific retry utilities
export const retryNetworkRequest = async <T>(
  requestFn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> => {
  return retryManager.execute(requestFn, {
    maxRetries: 3,
    baseDelay: 1000,
    backoffMultiplier: 2,
    maxDelay: 10000,
    ...options,
  });
};

export const retryWebSocketConnection = async <T>(
  connectFn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> => {
  return retryManager.execute(connectFn, {
    maxRetries: 5,
    baseDelay: 2000,
    backoffMultiplier: 1.5,
    maxDelay: 30000,
    ...options,
  });
};

export const retryWebRTCConnection = async <T>(
  connectFn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> => {
  return retryManager.execute(connectFn, {
    maxRetries: 2,
    baseDelay: 500,
    backoffMultiplier: 2,
    maxDelay: 5000,
    ...options,
  });
};

// Export retry manager for advanced usage
export { RetryManager };
