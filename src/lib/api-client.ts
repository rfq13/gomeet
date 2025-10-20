// API Client untuk komunikasi dengan backend Golang
import {
  safeGetLocalStorageItem,
  safeSetLocalStorageItem,
  safeRemoveLocalStorageItem,
} from "./storage-utils";

export interface APIError {
  code: string;
  message: string;
  details?: string;
}

export class APIException extends Error {
  constructor(public error: APIError) {
    super(error.message);
    this.name = "APIException";
  }
}

// User interface sesuai dengan backend
export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

// Auth response interface
export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

// API Client class
class APIClient {
  private baseURL: string;
  private accessToken: string | null = null;
  private isHydrated: boolean = false;

  constructor() {
    this.baseURL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

    // Load token dari localStorage saat inisialisasi (client-side only)
    if (typeof window !== "undefined") {
      // DEBUG LOGGING: Check localStorage availability
      console.log(
        "[DEBUG] API Client - Window available:",
        typeof window !== "undefined"
      );
      console.log(
        "[DEBUG] API Client - localStorage available:",
        typeof localStorage !== "undefined"
      );
      console.log(
        "[DEBUG] API Client - localStorage.getItem type:",
        typeof localStorage?.getItem
      );

      if (
        typeof localStorage !== "undefined" &&
        typeof localStorage.getItem === "function"
      ) {
        this.accessToken = localStorage.getItem("accessToken");
        console.log(
          "[DEBUG] API Client - Access token loaded:",
          !!this.accessToken
        );
      } else {
        console.log(
          "[DEBUG] API Client - localStorage.getItem is not a function!"
        );
      }
      this.isHydrated = true;
    }
  }

  // Method to set hydration state
  setHydrated() {
    if (!this.isHydrated) {
      this.accessToken = safeGetLocalStorageItem("accessToken");
      this.isHydrated = true;
    }
  }

  public async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };

    // Tambahkan authorization header jika ada token
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new APIException(
          data.error || {
            code: "UNKNOWN_ERROR",
            message: "An unknown error occurred",
          }
        );
      }

      return data;
    } catch (error) {
      if (error instanceof APIException) {
        throw error;
      }

      // Handle network errors
      throw new APIException({
        code: "NETWORK_ERROR",
        message: "Network error occurred",
        details:
          error instanceof Error ? error.message : "Unknown network error",
      });
    }
  }

  // Authentication methods
  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await this.request<{
      success: boolean;
      data: AuthResponse;
      message: string;
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    // Simpan token
    this.setTokens(response.data.accessToken, response.data.refreshToken);

    return response.data;
  }

  async register(
    username: string,
    email: string,
    password: string
  ): Promise<AuthResponse> {
    const response = await this.request<{
      success: boolean;
      data: AuthResponse;
      message: string;
    }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    });

    // Simpan token
    this.setTokens(response.data.accessToken, response.data.refreshToken);

    return response.data;
  }

  async logout(): Promise<void> {
    try {
      await this.request("/auth/logout", {
        method: "POST",
      });
    } finally {
      // Hapus token regardless of API call success
      this.clearTokens();
    }
  }

  async getCurrentUser(): Promise<User | null> {
    try {
      const response = await this.request<{ success: boolean; data: User }>(
        "/auth/me"
      );
      return response.data;
    } catch (error) {
      if (error instanceof APIException && error.error.code === "AUTH_004") {
        // Invalid token, clear tokens
        this.clearTokens();
      }
      return null;
    }
  }

  async refreshToken(): Promise<string> {
    // DEBUG LOGGING: Check localStorage availability for refresh token
    console.log(
      "[DEBUG] Refresh Token - Window available:",
      typeof window !== "undefined"
    );
    console.log(
      "[DEBUG] Refresh Token - localStorage available:",
      typeof localStorage !== "undefined"
    );
    console.log(
      "[DEBUG] Refresh Token - localStorage.getItem type:",
      typeof localStorage?.getItem
    );

    const refreshToken =
      typeof window !== "undefined" &&
      typeof localStorage !== "undefined" &&
      typeof localStorage.getItem === "function"
        ? localStorage.getItem("refreshToken")
        : null;

    console.log("[DEBUG] Refresh token retrieved:", !!refreshToken);

    if (!refreshToken) {
      throw new APIException({
        code: "NO_REFRESH_TOKEN",
        message: "No refresh token available",
      });
    }

    const response = await this.request<{
      success: boolean;
      data: { accessToken: string };
    }>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });

    // Update access token
    this.setTokens(response.data.accessToken, refreshToken);

    return response.data.accessToken;
  }

  // Token management
  private setTokens(accessToken: string, refreshToken: string): void {
    this.accessToken = accessToken;

    // Use safe localStorage methods
    safeSetLocalStorageItem("accessToken", accessToken);
    safeSetLocalStorageItem("refreshToken", refreshToken);
  }

  private clearTokens(): void {
    this.accessToken = null;

    // Use safe localStorage methods
    safeRemoveLocalStorageItem("accessToken");
    safeRemoveLocalStorageItem("refreshToken");
  }

  // Public method to get current token
  getAccessToken(): string | null {
    return this.accessToken;
  }

  // Public method to set token from outside
  setAccessToken(token: string | null): void {
    this.accessToken = token;
    if (token) {
      safeSetLocalStorageItem("accessToken", token);
    } else {
      safeRemoveLocalStorageItem("accessToken");
    }
  }
}

// Export singleton instance
export const apiClient = new APIClient();
