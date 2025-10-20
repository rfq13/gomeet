import { writable, derived } from "svelte/store";
import { authService } from "$lib/auth-service";
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

  // Initialize auth state
  async function initialize() {
    try {
      console.log("[Auth Store] Initializing auth state...");
      authStateStore.update((state) => ({ ...state, loading: true }));

      const user = await authService.getCurrentUser();
      console.log("[Auth Store] User retrieved:", user);

      authStateStore.set({
        user,
        loading: false,
        error: null,
        isAuthenticated: !!user,
        isHydrated: true,
      });

      console.log("[Auth Store] Auth state set:", {
        user: !!user,
        isAuthenticated: !!user,
      });
    } catch (error) {
      console.error("[Auth Store] Failed to initialize auth:", error);
      authStateStore.set({
        user: null,
        loading: false,
        error:
          error instanceof Error ? error.message : "Failed to initialize auth",
        isAuthenticated: false,
        isHydrated: true,
      });
    }
  }

  // Login function
  async function login(email: string, password: string) {
    try {
      authStateStore.update((state) => ({
        ...state,
        loading: true,
        error: null,
      }));

      const response = await authService.login(email, password);
      authStateStore.set({
        user: response.user,
        loading: false,
        error: null,
        isAuthenticated: true,
        isHydrated: true,
      });

      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Login failed";
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
      authStateStore.update((state) => ({
        ...state,
        loading: true,
        error: null,
      }));

      const response = await authService.register(username, email, password);

      authStateStore.set({
        user: response.user,
        loading: false,
        error: null,
        isAuthenticated: true,
        isHydrated: true,
      });

      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Registration failed";
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
      authStateStore.update((state) => ({ ...state, loading: true }));

      await authService.logout();

      authStateStore.set({
        user: null,
        loading: false,
        error: null,
        isAuthenticated: false,
        isHydrated: true,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Logout failed";
      authStateStore.update((state) => ({
        ...state,
        loading: false,
        error: errorMessage,
      }));
    }
  }

  // Clear error function
  function clearError() {
    authStateStore.update((state) => ({ ...state, error: null }));
  }

  return {
    subscribe: authStateStore.subscribe,
    isAuthenticated,
    initialize,
    login,
    register,
    logout,
    clearError,
  };
}

export const authStore = createAuthStore();
export type { User };
