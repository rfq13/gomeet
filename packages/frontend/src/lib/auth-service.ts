import { apiClient, APIException } from "./api-client";
import { cacheManager } from "./cache";
import type { User, AuthResponse } from "$types";

// Auth service untuk mengelola autentikasi
export class AuthService {
  // Login dengan email dan password
  async login(email: string, password: string): Promise<AuthResponse> {
    try {
      const response = await apiClient.login(email, password);

      // Cache the current user after successful login
      cacheManager.cacheCurrentUser(response.user);

      return response;
    } catch (error) {
      if (error instanceof APIException) {
        throw error;
      }
      throw new APIException({
        code: "LOGIN_ERROR",
        message: "Login failed",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Registrasi user baru
  async register(
    username: string,
    email: string,
    password: string
  ): Promise<AuthResponse> {
    try {
      const response = await apiClient.register(username, email, password);

      // Cache the current user after successful registration
      cacheManager.cacheCurrentUser(response.user);

      return response;
    } catch (error) {
      if (error instanceof APIException) {
        throw error;
      }
      throw new APIException({
        code: "REGISTER_ERROR",
        message: "Registration failed",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Logout user
  async logout(): Promise<void> {
    try {
      await apiClient.logout();
    } catch (error) {
      // Tetap lanjutkan proses logout lokal meskipun API call gagal
      console.warn("Logout API call failed:", error);
      apiClient.setAccessToken(null);
    } finally {
      // Clear user cache regardless of API call success
      cacheManager.invalidateAllUsers();
    }
  }

  // Mendapatkan user yang sedang login
  async getCurrentUser(useCache: boolean = true): Promise<User | null> {
    try {
      // Try to get from cache first
      if (useCache) {
        const cachedUser = cacheManager.getCachedCurrentUser();
        if (cachedUser) {
          return cachedUser;
        }
      }

      const user = await apiClient.getCurrentUser();

      // Cache the user if found
      if (user) {
        cacheManager.cacheCurrentUser(user);
      }

      return user;
    } catch (error) {
      console.warn("Failed to get current user:", error);
      return null;
    }
  }

  // Refresh token
  async refreshToken(): Promise<string> {
    try {
      return await apiClient.refreshToken();
    } catch (error) {
      if (error instanceof APIException) {
        throw error;
      }
      throw new APIException({
        code: "TOKEN_REFRESH_ERROR",
        message: "Failed to refresh token",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Cek apakah user sudah login (ada token)
  isAuthenticated(): boolean {
    return !!apiClient.getAccessToken();
  }

  // Dapatkan access token
  getAccessToken(): string | null {
    return apiClient.getAccessToken();
  }
}

// Export singleton instance
export const authService = new AuthService();
