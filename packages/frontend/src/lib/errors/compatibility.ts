// Backward compatibility layer for existing error handling
// This ensures that existing code continues to work while migrating to the new error system

import { errorStore, ErrorCode, ErrorCategory } from "./index";

// Legacy error class that mimics the old APIException
export class LegacyAPIException extends Error {
  public code: string;
  public message: string;
  public details?: string;

  constructor(error: { code: string; message: string; details?: string }) {
    super(error.message);
    this.name = "APIException";
    this.code = error.code;
    this.message = error.message;
    this.details = error.details;
  }

  // Convert to new error format
  toAppError() {
    const errorCode = this.mapLegacyCode(this.code);
    const category = this.mapLegacyCategory(this.code);

    return errorStore.createError(errorCode, category, this.message, this, {
      action: "legacy_api_call",
      additionalData: {
        legacyCode: this.code,
        details: this.details,
      },
    });
  }

  private mapLegacyCode(legacyCode: string): ErrorCode {
    // Map legacy error codes to new error codes
    const codeMap: Record<string, ErrorCode> = {
      NETWORK_ERROR: ErrorCode.NETWORK_CONNECTION_FAILED,
      AUTH_004: ErrorCode.AUTH_NOT_AUTHENTICATED,
      NOT_FOUND: ErrorCode.MTG_NOT_FOUND,
      UNKNOWN_ERROR: ErrorCode.UNKNOWN_ERROR,
      // Add more mappings as needed
    };

    return codeMap[legacyCode] || ErrorCode.UNKNOWN_ERROR;
  }

  private mapLegacyCategory(legacyCode: string): ErrorCategory {
    if (legacyCode.startsWith("AUTH_")) return ErrorCategory.AUTHENTICATION;
    if (legacyCode.startsWith("NET_")) return ErrorCategory.NETWORK;
    if (legacyCode.includes("NETWORK")) return ErrorCategory.NETWORK;
    if (legacyCode.includes("AUTH")) return ErrorCategory.AUTHENTICATION;

    return ErrorCategory.UNKNOWN;
  }
}

// Legacy error handling functions that wrap the new system
export const legacyErrorHandler = {
  // Handle legacy API exceptions
  handleAPIException: (error: any) => {
    if (error instanceof LegacyAPIException) {
      const appError = error.toAppError();
      errorStore.addError(
        appError.code,
        appError.category,
        appError.message,
        appError.originalError,
        appError.context
      );
      return error;
    }

    // Handle regular errors
    if (error instanceof Error) {
      errorStore.addError(
        ErrorCode.UNKNOWN_ERROR,
        ErrorCategory.UNKNOWN,
        error.message,
        error,
        { action: "legacy_error_handling" }
      );
    }

    return error;
  },

  // Legacy console.error wrapper
  consoleError: (message: string, error?: any) => {
    console.error(message, error);

    if (error) {
      errorStore.addError(
        ErrorCode.UNKNOWN_ERROR,
        ErrorCategory.UNKNOWN,
        message,
        error instanceof Error ? error : new Error(String(error)),
        { action: "legacy_console_error" }
      );
    }
  },

  // Legacy alert wrapper
  alert: (message: string) => {
    alert(message);

    errorStore.addError(
      ErrorCode.VAL_INVALID_INPUT,
      ErrorCategory.VALIDATION,
      message,
      new Error(message),
      { action: "legacy_alert" }
    );
  },
};

// Migration helper functions
export const migrationHelpers = {
  // Convert existing error handling patterns
  convertTryCatch: async <T>(
    fn: () => Promise<T>,
    context?: { action?: string; component?: string }
  ): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      legacyErrorHandler.handleAPIException(error);
      throw error;
    }
  },

  // Wrap existing service methods
  wrapServiceMethod: <T extends any[], R>(
    serviceMethod: (...args: T) => Promise<R>,
    methodName: string
  ) => {
    return async (...args: T): Promise<R> => {
      try {
        return await serviceMethod(...args);
      } catch (error) {
        legacyErrorHandler.handleAPIException(error);
        throw error;
      }
    };
  },

  // Gradual migration flag
  isMigrationEnabled: () => {
    return (
      typeof window !== "undefined" &&
      (window.localStorage.getItem("ENABLE_NEW_ERROR_HANDLING") === "true" ||
        import.meta.env.DEV)
    ); // Enable in development by default
  },
};

// Type guards for legacy error detection
export const isLegacyError = (error: any): error is LegacyAPIException => {
  return (
    error instanceof LegacyAPIException ||
    (error &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error)
  );
};

// Auto-migration hook
export const setupAutoMigration = () => {
  if (migrationHelpers.isMigrationEnabled()) {
    // Override global error handlers if in development
    if (typeof window !== "undefined" && import.meta.env.DEV) {
      const originalConsoleError = console.error;
      console.error = (...args: any[]) => {
        originalConsoleError(...args);

        if (args.length > 0 && typeof args[0] === "string") {
          legacyErrorHandler.consoleError(args[0], args[1]);
        }
      };

      // Cleanup function
      return () => {
        console.error = originalConsoleError;
      };
    }
  }

  return () => {}; // No-op cleanup
};

// Export for backward compatibility
export { LegacyAPIException as APIException };
