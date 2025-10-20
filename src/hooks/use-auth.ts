import { useState, useEffect, useCallback } from "react";
import { authService, User } from "@/lib/auth-service";
import { apiClient } from "@/lib/api-client";
import { APIException } from "@/lib/api-client";

interface UseAuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
}

interface UseAuthActions {
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    fullName: string;
    email: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  clearError: () => void;
}

export function useAuth(): UseAuthState & UseAuthActions {
  const [state, setState] = useState<UseAuthState>({
    user: null,
    loading: true,
    error: null,
    isAuthenticated: false,
    isHydrated: false,
  });

  // Fungsi untuk memperbarui state
  const updateState = useCallback((updates: Partial<UseAuthState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  // Fungsi untuk menghandle error
  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof APIException) {
        updateState({
          error: error.error.message,
          loading: false,
        });
      } else {
        updateState({
          error:
            error instanceof Error
              ? error.message
              : "An unknown error occurred",
          loading: false,
        });
      }
    },
    [updateState]
  );

  // Clear error
  const clearError = useCallback(() => {
    updateState({ error: null });
  }, [updateState]);

  // Check authentication status on mount
  useEffect(() => {
    // Only run on client side
    if (typeof window === "undefined") return;

    const checkAuth = async () => {
      try {
        // Set hydrated state first
        apiClient.setHydrated();
        setState((prev) => ({ ...prev, isHydrated: true }));

        if (authService.isAuthenticated()) {
          const user = await authService.getCurrentUser();
          updateState({
            user,
            loading: false,
            isAuthenticated: !!user,
          });
        } else {
          updateState({
            loading: false,
            isAuthenticated: false,
          });
        }
      } catch (error) {
        updateState({
          loading: false,
          isAuthenticated: false,
        });
      }
    };

    checkAuth();
  }, [updateState, handleError]);

  // Login function
  const login = useCallback(
    async (email: string, password: string, onSuccess?: Function) => {
      try {
        updateState({ loading: true, error: null });

        const response = await authService.login(email, password);

        updateState({
          user: response.user,
          loading: false,
          error: null,
          isAuthenticated: true,
        });

        if (onSuccess) onSuccess();
      } catch (error) {
        handleError(error);
      }
    },
    [updateState, handleError]
  );

  // Register function
  const register = useCallback(
    async (data: { fullName: string; email: string; password: string }) => {
      try {
        updateState({ loading: true, error: null });

        const response = await authService.register(
          data.fullName,
          data.email,
          data.password
        );

        updateState({
          user: response.user,
          loading: false,
          error: null,
          isAuthenticated: true,
        });
      } catch (error) {
        handleError(error);
      }
    },
    [updateState, handleError]
  );

  // Logout function
  const logout = useCallback(async () => {
    try {
      updateState({ loading: true });
      await authService.logout();

      updateState({
        user: null,
        loading: false,
        error: null,
        isAuthenticated: false,
      });
    } catch (error) {
      // Tetap logout meskipun API call gagal
      updateState({
        user: null,
        loading: false,
        error: null,
        isAuthenticated: false,
      });
    }
  }, [updateState]);

  // Refresh token function
  const refreshToken = useCallback(async () => {
    try {
      await authService.refreshToken();

      // Setelah refresh token, coba dapatkan user lagi
      const user = await authService.getCurrentUser();
      updateState({
        user,
        isAuthenticated: !!user,
      });
    } catch (error) {
      // Jika refresh token gagal, logout user
      updateState({
        user: null,
        loading: false,
        error: "Session expired. Please login again.",
        isAuthenticated: false,
      });
    }
  }, [updateState]);

  return {
    ...state,
    login,
    register,
    logout,
    refreshToken,
    clearError,
  };
}
