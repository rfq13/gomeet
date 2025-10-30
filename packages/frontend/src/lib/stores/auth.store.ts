import { writable, derived, get } from "svelte/store";
import { authService } from "$lib/auth-service";
import {
  errorStore,
  ErrorCode,
  ErrorCategory,
  logUserAction,
} from "$lib/errors";
import type { User, AuthState } from "$types";

// Create auth store with initial state
function createAuthStore() {
  const authStateStore = writable<AuthState>({
    user: null,
    loading: true,
    error: null,
    isAuthenticated: false,
    isHydrated: false,
  });

  // Derived store for authentication status
  const isAuthenticated = derived(
    authStateStore,
    ($authState) => $authState.isAuthenticated && $authState.isHydrated
  );

  // Race condition prevention: Track initialization promise
  let initPromise: Promise<void> | null = null;
  let isInitializing = false;

  // Initialize auth state with race condition protection
  async function initialize(): Promise<void> {
    // If already initializing, return the existing promise
    if (isInitializing && initPromise) {
      console.log(
        "[Auth Store] Initialization already in progress, returning existing promise"
      );
      return initPromise;
    }

    // If already hydrated and not loading, no need to reinitialize
    const currentState = get(authStateStore);
    if (currentState.isHydrated && !currentState.loading) {
      console.log("[Auth Store] Already hydrated, skipping initialization");
      return;
    }

    // Set initialization flag and create new promise
    isInitializing = true;
    console.log("[Auth Store] Starting auth initialization...");

    initPromise = (async () => {
      try {
        // Update loading state
        authStateStore.update((state) => ({
          ...state,
          loading: true,
          error: null,
        }));

        console.log("[Auth Store] Fetching current user...");
        const user = await authService.getCurrentUser();
        console.log("[Auth Store] User retrieved successfully:", {
          hasUser: !!user,
          userId: user?.id,
          username: user?.username,
        });

        // Set final state
        authStateStore.set({
          user,
          loading: false,
          error: null,
          isAuthenticated: !!user,
          isHydrated: true,
        });

        console.log("[Auth Store] Auth state initialized successfully:", {
          isAuthenticated: !!user,
          isHydrated: true,
          userId: user?.id,
          username: user?.username,
        });
      } catch (error) {
        console.error("[Auth Store] Failed to initialize auth state:", {
          error: error instanceof Error ? error.message : "Unknown error",
          stack: error instanceof Error ? error.stack : undefined,
        });

        // Set error state
        authStateStore.set({
          user: null,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to initialize auth",
          isAuthenticated: false,
          isHydrated: true,
        });
      } finally {
        // Reset initialization flag
        isInitializing = false;
        initPromise = null;
        console.log("[Auth Store] Initialization completed");
      }
    })();

    return initPromise;
  }

  // Login function
  async function login(email: string, password: string) {
    try {
      console.log("[Auth Store] Starting login process...");
      authStateStore.update((state) => ({
        ...state,
        loading: true,
        error: null,
      }));

      const response = await authService.login(email, password);
      console.log("[Auth Store] Login successful:", {
        userId: response.user?.id,
        username: response.user?.username,
      });

      authStateStore.set({
        user: response.user,
        loading: false,
        error: null,
        isAuthenticated: true,
        isHydrated: true,
      });

      // Reset initialization state after successful login
      isInitializing = false;
      initPromise = null;

      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Login failed";
      console.error("[Auth Store] Login failed:", {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Log to error store
      errorStore.addAuthError(
        errorMessage,
        error instanceof Error ? error : new Error("Login failed"),
        { action: "login", additionalData: { email } }
      );

      // Log user action
      logUserAction("login_attempt", {
        email,
        success: false,
        error: errorMessage,
      });

      authStateStore.update((state) => ({
        ...state,
        loading: false,
        error: errorMessage,
        isAuthenticated: false,
      }));
      throw error;
    }
  }

  // Register function
  async function register(username: string, email: string, password: string) {
    try {
      console.log("[Auth Store] Starting registration process...");
      authStateStore.update((state) => ({
        ...state,
        loading: true,
        error: null,
      }));

      const response = await authService.register(username, email, password);
      console.log("[Auth Store] Registration successful:", {
        userId: response.user?.id,
        username: response.user?.username,
      });

      authStateStore.set({
        user: response.user,
        loading: false,
        error: null,
        isAuthenticated: true,
        isHydrated: true,
      });

      // Reset initialization state after successful registration
      isInitializing = false;
      initPromise = null;

      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Registration failed";
      console.error("[Auth Store] Registration failed:", {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      authStateStore.update((state) => ({
        ...state,
        loading: false,
        error: errorMessage,
        isAuthenticated: false,
      }));
      throw error;
    }
  }

  // Logout function
  async function logout() {
    try {
      console.log("[Auth Store] Starting logout process...");
      authStateStore.update((state) => ({ ...state, loading: true }));

      await authService.logout();
      console.log("[Auth Store] Logout successful");

      authStateStore.set({
        user: null,
        loading: false,
        error: null,
        isAuthenticated: false,
        isHydrated: true,
      });

      // Reset initialization state after logout
      isInitializing = false;
      initPromise = null;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Logout failed";
      console.error("[Auth Store] Logout failed:", {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      authStateStore.update((state) => ({
        ...state,
        loading: false,
        error: errorMessage,
      }));
    }
  }

  // Clear error function
  function clearError() {
    console.log("[Auth Store] Clearing error state");
    authStateStore.update((state) => ({ ...state, error: null }));
  }

  // Force reinitialize function (for testing or manual refresh)
  async function forceReinitialize(): Promise<void> {
    console.log("[Auth Store] Force reinitializing auth state...");
    isInitializing = false;
    initPromise = null;
    return initialize();
  }

  return {
    subscribe: authStateStore.subscribe,
    isAuthenticated,
    initialize,
    login,
    register,
    logout,
    clearError,
    forceReinitialize, // Expose for testing/debugging purposes
  };
}

export const authStore = createAuthStore();
export type { User };
