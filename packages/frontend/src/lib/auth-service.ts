import { apiClient, APIException } from "./api-client";
import type { User, AuthResponse } from "$types";

// Auth service untuk mengelola autentikasi
export class AuthService {
  // Login dengan email dan password
  async login(email: string, password: string): Promise<AuthResponse> {
    try {
      return await apiClient.login(email, password);
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
      return await apiClient.register(username, email, password);
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
    }
  }

  // Mendapatkan user yang sedang login
  async getCurrentUser(): Promise<User | null> {
    try {
      return await apiClient.getCurrentUser();
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
