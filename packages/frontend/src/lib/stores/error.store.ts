import { writable, derived, get } from "svelte/store";
import {
  ErrorCode,
  ErrorCategory,
  type AppError,
  type ErrorState,
  type ErrorContext,
  type ErrorLogEntry,
  type RetryConfig,
  type ErrorNotification,
} from "$lib/errors/types";
import {
  getErrorMessage,
  getErrorCategoryName,
  isRetryableError,
  getRetryDelay,
  shouldShowUserNotification,
  getErrorSeverity,
} from "$lib/errors/messages";

// Initial state
const initialState: ErrorState = {
  errors: [],
  currentError: null,
  errorHistory: [],
  isLoading: false,
  retryQueue: [],
};

// Create the error store
function createErrorStore() {
  const { subscribe, set, update } = writable<ErrorState>(initialState);

  // Retry configuration
  const defaultRetryConfig: RetryConfig = {
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2,
    maxDelay: 30000,
  };

  // Generate unique error ID
  const generateErrorId = (): string => {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  // Create standardized error object
  const createError = (
    code: ErrorCode,
    category: ErrorCategory,
    message: string,
    originalError?: Error | any,
    context?: ErrorContext,
    retryable?: boolean
  ): AppError => {
    const isRetryable =
      retryable !== undefined ? retryable : isRetryableError(code);

    return {
      id: generateErrorId(),
      code,
      category,
      message,
      userMessage: getErrorMessage(code),
      originalError,
      context: {
        timestamp: new Date().toISOString(),
        ...context,
      },
      retryable: isRetryable,
      retryCount: 0,
      maxRetries: isRetryable ? defaultRetryConfig.maxRetries : 0,
      timestamp: new Date().toISOString(),
    };
  };

  // Log error to console and history
  const logError = (error: AppError) => {
    // Console logging with structured format
    const logData = {
      id: error.id,
      code: error.code,
      category: error.category,
      message: error.message,
      userMessage: error.userMessage,
      context: error.context,
      timestamp: error.timestamp,
      severity: getErrorSeverity(error.code),
    };

    // Log to console with appropriate level
    const severity = getErrorSeverity(error.code);
    switch (severity) {
      case "critical":
        console.error("🚨 [CRITICAL ERROR]", logData);
        break;
      case "high":
        console.error("❌ [ERROR]", logData);
        break;
      case "medium":
        console.warn("⚠️ [WARNING]", logData);
        break;
      default:
        console.log("ℹ️ [INFO]", logData);
    }

    // Add to error history
    update((state) => {
      const logEntry: ErrorLogEntry = {
        id: generateErrorId(),
        error: { ...error },
        userAgent:
          typeof window !== "undefined"
            ? window.navigator.userAgent
            : "Unknown",
        url: typeof window !== "undefined" ? window.location.href : "Unknown",
        stackTrace: error.originalError?.stack,
        resolved: false,
      };

      return {
        ...state,
        errorHistory: [logEntry, ...state.errorHistory].slice(0, 100), // Keep last 100 errors
      };
    });
  };

  // Add error to store
  const addError = (
    code: ErrorCode,
    category: ErrorCategory,
    message: string,
    originalError?: Error | any,
    context?: ErrorContext,
    retryable?: boolean
  ) => {
    const error = createError(
      code,
      category,
      message,
      originalError,
      context,
      retryable
    );

    logError(error);

    update((state) => ({
      ...state,
      errors: [...state.errors, error],
      currentError: error,
    }));

    // Add to retry queue if retryable
    if (error.retryable) {
      addToRetryQueue(error);
    }

    return error;
  };

  // Add to retry queue
  const addToRetryQueue = (error: AppError) => {
    update((state) => ({
      ...state,
      retryQueue: [...state.retryQueue, error],
    }));
  };

  // Remove from retry queue
  const removeFromRetryQueue = (errorId: string) => {
    update((state) => ({
      ...state,
      retryQueue: state.retryQueue.filter((error) => error.id !== errorId),
    }));
  };

  // Retry failed operation
  const retryError = async (errorId: string, retryFn?: () => Promise<any>) => {
    const state = get(store);
    const error = state.errors.find((e) => e.id === errorId);

    if (!error || !error.retryable || !retryFn) {
      return false;
    }

    if (error.retryCount! >= error.maxRetries!) {
      removeFromRetryQueue(errorId);
      return false;
    }

    // Update retry count
    update((state) => ({
      ...state,
      errors: state.errors.map((e) =>
        e.id === errorId ? { ...e, retryCount: (e.retryCount || 0) + 1 } : e
      ),
    }));

    // Calculate delay
    const delay = getRetryDelay(error.retryCount || 0);

    // Wait before retry
    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await retryFn();
      // Success - remove from queue
      removeFromRetryQueue(errorId);
      clearError(errorId);
      return true;
    } catch (retryError) {
      // Retry failed - update error
      update((state) => ({
        ...state,
        errors: state.errors.map((e) =>
          e.id === errorId
            ? {
                ...e,
                originalError: retryError,
                timestamp: new Date().toISOString(),
              }
            : e
        ),
      }));

      // If max retries reached, remove from queue
      const updatedError = get(store).errors.find((e) => e.id === errorId);
      if (
        updatedError &&
        updatedError.retryCount! >= updatedError.maxRetries!
      ) {
        removeFromRetryQueue(errorId);
      }

      return false;
    }
  };

  // Clear specific error
  const clearError = (errorId: string) => {
    update((state) => {
      const newErrors = state.errors.filter((e) => e.id !== errorId);
      return {
        ...state,
        errors: newErrors,
        currentError:
          state.currentError?.id === errorId
            ? newErrors.length > 0
              ? newErrors[newErrors.length - 1]
              : null
            : state.currentError,
      };
    });
  };

  // Clear all errors
  const clearAllErrors = () => {
    update((state) => ({
      ...state,
      errors: [],
      currentError: null,
      retryQueue: [],
    }));
  };

  // Mark error as resolved
  const resolveError = (errorId: string) => {
    update((state) => ({
      ...state,
      errorHistory: state.errorHistory.map((entry) =>
        entry.error.id === errorId
          ? { ...entry, resolved: true, resolvedAt: new Date().toISOString() }
          : entry
      ),
    }));

    clearError(errorId);
  };

  // Get errors by category
  const getErrorsByCategory = (category: ErrorCategory) => {
    return derived(store, (state) =>
      state.errors.filter((error) => error.category === category)
    );
  };

  // Get retryable errors
  const getRetryableErrors = () => {
    return derived(store, (state) => state.retryQueue);
  };

  // Get error count by severity
  const getErrorCountBySeverity = () => {
    return derived(store, (state) => {
      const counts = { critical: 0, high: 0, medium: 0, low: 0 };
      state.errors.forEach((error) => {
        const severity = getErrorSeverity(error.code);
        counts[severity]++;
      });
      return counts;
    });
  };

  // Check if should show notification
  const shouldShowNotification = (error: AppError) => {
    return shouldShowUserNotification(error.code);
  };

  // Create notification from error
  const createNotification = (error: AppError): ErrorNotification => {
    const severity = getErrorSeverity(error.code);
    const type =
      severity === "critical" || severity === "high"
        ? "error"
        : severity === "medium"
          ? "warning"
          : "info";

    const notification: ErrorNotification = {
      id: error.id,
      type,
      title: getErrorCategoryName(error.category),
      message: error.userMessage,
      duration: type === "error" ? 5000 : 3000,
      persistent: severity === "critical",
    };

    // Add retry action for retryable errors
    if (error.retryable && error.retryCount! < error.maxRetries!) {
      notification.actions = [
        {
          label: "Coba Lagi",
          action: () => retryError(error.id),
          variant: "primary",
        },
        {
          label: "Tutup",
          action: () => clearError(error.id),
          variant: "secondary",
        },
      ];
    } else {
      notification.actions = [
        {
          label: "Tutup",
          action: () => clearError(error.id),
          variant: "secondary",
        },
      ];
    }

    return notification;
  };

  // Convenience methods for common error types
  const addNetworkError = (
    message: string,
    originalError?: Error,
    context?: ErrorContext
  ) => {
    return addError(
      ErrorCode.NETWORK_CONNECTION_FAILED,
      ErrorCategory.NETWORK,
      message,
      originalError,
      context
    );
  };

  const addAuthError = (
    message: string,
    originalError?: Error,
    context?: ErrorContext
  ) => {
    return addError(
      ErrorCode.AUTH_NOT_AUTHENTICATED,
      ErrorCategory.AUTHENTICATION,
      message,
      originalError,
      context
    );
  };

  const addValidationError = (
    message: string,
    originalError?: Error,
    context?: ErrorContext
  ) => {
    return addError(
      ErrorCode.VAL_INVALID_INPUT,
      ErrorCategory.VALIDATION,
      message,
      originalError,
      context
    );
  };

  const addWebRTCError = (
    message: string,
    originalError?: Error,
    context?: ErrorContext
  ) => {
    return addError(
      ErrorCode.RTC_CONNECTION_FAILED,
      ErrorCategory.WEBRTC,
      message,
      originalError,
      context
    );
  };

  const addMeetingError = (
    message: string,
    originalError?: Error,
    context?: ErrorContext
  ) => {
    return addError(
      ErrorCode.MTG_JOIN_FAILED,
      ErrorCategory.MEETING,
      message,
      originalError,
      context
    );
  };

  // Export store methods
  const store = {
    subscribe,

    // Core methods
    addError,
    clearError,
    clearAllErrors,
    resolveError,
    retryError,

    // Convenience methods
    addNetworkError,
    addAuthError,
    addValidationError,
    addWebRTCError,
    addMeetingError,

    // Derived stores
    getErrorsByCategory,
    getRetryableErrors,
    getErrorCountBySeverity,

    // Utilities
    shouldShowNotification,
    createNotification,

    // Internal methods
    generateErrorId,
    createError,
  };

  return store;
}

// Export singleton instance
export const errorStore = createErrorStore();

// Export derived stores for common use cases
export const currentError = derived(errorStore, (store) => store.currentError);
export const hasErrors = derived(
  errorStore,
  (store) => store.errors.length > 0
);
export const retryableErrors = errorStore.getRetryableErrors();
export const errorCountBySeverity = errorStore.getErrorCountBySeverity();
