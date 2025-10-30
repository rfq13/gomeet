// Centralized Error Handling System
// Export all error handling utilities

// Types and interfaces
export * from "./types";

// Error messages and utilities
export * from "./messages";

// Error store
export {
  errorStore,
  currentError,
  hasErrors,
  retryableErrors,
  errorCountBySeverity,
} from "../stores/error.store";

// Error logger
export {
  errorLogger,
  logError,
  logUserAction,
  logPerformance,
  logNetworkRequest,
} from "./logger";

// Retry mechanism
export {
  retryManager,
  withRetry,
  withExponentialBackoff,
  withLinearBackoff,
  withFixedDelay,
  retryNetworkRequest,
  retryWebSocketConnection,
  retryWebRTCConnection,
} from "./retry";

// Error boundary component
export { default as ErrorBoundary } from "../components/ErrorBoundary.svelte";
