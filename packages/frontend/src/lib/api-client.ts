// API Client untuk komunikasi dengan backend Golang
import type {
  APIResponse,
  APIError,
  User,
  AuthResponse,
  PublicUser,
  PublicUserResponse,
  CreatePublicUserRequest,
  JoinMeetingAsPublicUserRequest,
  LeaveMeetingAsPublicUserRequest,
} from "$types";
import {
  errorStore,
  ErrorCode,
  ErrorCategory,
  retryNetworkRequest,
  logNetworkRequest,
} from "$lib/errors";
import { cacheManager } from "./cache";

export class APIException extends Error {
  constructor(public error: APIError) {
    super(error.message);
    this.name = "APIException";
  }
}

// API Client class
class APIClient {
  private baseURL: string;
  private accessToken: string | null = null;
  private isHydrated: boolean = false;

  constructor() {
    this.baseURL = import.meta.env.VITE_API_URL || "http://localhost:8080";

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
      this.accessToken = this.safeGetLocalStorageItem("accessToken");
      this.isHydrated = true;
    }
  }

  // Safe localStorage methods
  private safeGetLocalStorageItem(key: string): string | null {
    if (
      typeof window !== "undefined" &&
      typeof localStorage !== "undefined" &&
      typeof localStorage.getItem === "function"
    ) {
      return localStorage.getItem(key);
    }
    return null;
  }

  private safeSetLocalStorageItem(key: string, value: string): void {
    if (
      typeof window !== "undefined" &&
      typeof localStorage !== "undefined" &&
      typeof localStorage.setItem === "function"
    ) {
      localStorage.setItem(key, value);
    }
  }

  private safeRemoveLocalStorageItem(key: string): void {
    if (
      typeof window !== "undefined" &&
      typeof localStorage !== "undefined" &&
      typeof localStorage.removeItem === "function"
    ) {
      localStorage.removeItem(key);
    }
  }

  public async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    return retryNetworkRequest(
      async () => {
        const startTime = Date.now();

        // Fix double slash issue
        const cleanEndpoint = endpoint.startsWith("/")
          ? endpoint
          : `/${endpoint}`;
        const url = `${this.baseURL}/api/v1${cleanEndpoint}`;

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

          const duration = Date.now() - startTime;

          // Log network request
          logNetworkRequest(
            url,
            options.method || "GET",
            response.status,
            duration
          );

          const data = await response.json();

          if (!response.ok) {
            // Map HTTP status to error codes
            let errorCode: ErrorCode;
            let errorCategory: ErrorCategory;

            switch (response.status) {
              case 401:
                errorCode = ErrorCode.AUTH_NOT_AUTHENTICATED;
                errorCategory = ErrorCategory.AUTHENTICATION;
                break;
              case 403:
                errorCode = ErrorCode.PERM_ACCESS_DENIED;
                errorCategory = ErrorCategory.AUTHORIZATION;
                break;
              case 404:
                errorCode = ErrorCode.MTG_NOT_FOUND;
                errorCategory = ErrorCategory.MEETING;
                break;
              case 429:
                errorCode = ErrorCode.NETWORK_RATE_LIMIT;
                errorCategory = ErrorCategory.NETWORK;
                break;
              case 500:
              case 502:
              case 503:
              case 504:
                errorCode = ErrorCode.NETWORK_SERVER_ERROR;
                errorCategory = ErrorCategory.NETWORK;
                break;
              default:
                errorCode = ErrorCode.UNKNOWN_ERROR;
                errorCategory = ErrorCategory.UNKNOWN;
            }

            // Create standardized error
            const apiError = data.error || {
              code: errorCode,
              message:
                data.message ||
                `HTTP ${response.status}: ${response.statusText}`,
            };

            // Log to error store
            errorStore.addError(
              errorCode,
              errorCategory,
              apiError.message,
              new Error(apiError.message),
              {
                action: `${options.method || "GET"} ${endpoint}`,
                additionalData: {
                  endpoint,
                  method: options.method || "GET",
                  status: response.status,
                  url: url,
                },
              }
            );

            throw new APIException(apiError);
          }

          return data;
        } catch (error) {
          const duration = Date.now() - startTime;

          if (error instanceof APIException) {
            throw error;
          }

          // Handle network errors
          const networkError = new APIException({
            code: ErrorCode.NETWORK_CONNECTION_FAILED,
            message: "Network error occurred",
            details:
              error instanceof Error ? error.message : "Unknown network error",
          });

          // Log network error
          logNetworkRequest(url, options.method || "GET", 0, duration, {
            error: error instanceof Error ? error.message : "Unknown",
          });

          // Log to error store
          errorStore.addNetworkError(
            networkError.error.message,
            error instanceof Error ? error : new Error("Network error"),
            {
              action: `${options.method || "GET"} ${endpoint}`,
              additionalData: {
                endpoint,
                method: options.method || "GET",
                url: url,
              },
            }
          );

          throw networkError;
        }
      },
      {
        maxRetries: 3,
        baseDelay: 1000,
        onRetry: (attempt, error) => {
          console.log(
            `API request retry attempt ${attempt} for ${endpoint}:`,
            error
          );
        },
      }
    );
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
      const response = await this.request<{
        success: boolean;
        data: { user: User };
      }>("/auth/me");
      const user = response.data.user || response.data;

      // Cache the user profile
      if (user) {
        cacheManager.cacheUserProfile(user);
      }

      return user;
    } catch (error) {
      if (error instanceof APIException && error.error.code === "AUTH_004") {
        // Invalid token, clear tokens and cache
        this.clearTokens();
        cacheManager.invalidateAllUsers();
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
    this.safeSetLocalStorageItem("accessToken", accessToken);
    this.safeSetLocalStorageItem("refreshToken", refreshToken);
  }

  private clearTokens(): void {
    this.accessToken = null;

    // Use safe localStorage methods
    this.safeRemoveLocalStorageItem("accessToken");
    this.safeRemoveLocalStorageItem("refreshToken");
  }

  // Public method to get current token
  getAccessToken(): string | null {
    return this.accessToken;
  }

  // Public method to set token from outside
  setAccessToken(token: string | null): void {
    this.accessToken = token;
    if (token) {
      this.safeSetLocalStorageItem("accessToken", token);
    } else {
      this.safeRemoveLocalStorageItem("accessToken");
    }
  }

  // Public User methods
  async createPublicUser(
    name: string,
    sessionId: string
  ): Promise<PublicUserResponse> {
    const response = await this.request<{
      success: boolean;
      data: PublicUserResponse;
      message: string;
    }>("/public-users", {
      method: "POST",
      body: JSON.stringify({ name, sessionId } as CreatePublicUserRequest),
    });

    // Cache the public user
    cacheManager.cacheUserProfile({
      id: response.data.id,
      username: response.data.name,
      email: "",
      createdAt: response.data.createdAt,
      updatedAt: response.data.createdAt,
    } as User);

    return response.data;
  }

  async getPublicUserBySessionId(
    sessionId: string
  ): Promise<PublicUserResponse | null> {
    try {
      // Try to get from cache first
      const cachedUser = cacheManager.getCachedUserProfile(sessionId);
      if (cachedUser) {
        return {
          id: cachedUser.id,
          name: cachedUser.username,
          sessionId: sessionId,
          createdAt: cachedUser.createdAt,
        };
      }

      const response = await this.request<{
        success: boolean;
        data: PublicUserResponse;
        message: string;
      }>(`/public-users/session/${sessionId}`);

      // Cache the public user
      cacheManager.cacheUserProfile({
        id: response.data.id,
        username: response.data.name,
        email: "",
        createdAt: response.data.createdAt,
        updatedAt: response.data.createdAt,
      } as User);

      return response.data;
    } catch (error) {
      if (error instanceof APIException && error.error.code === "NOT_FOUND") {
        return null;
      }
      throw error;
    }
  }

  async joinMeetingAsPublicUser(
    sessionId: string,
    meetingId: string
  ): Promise<any> {
    const response = await this.request<{
      success: boolean;
      data: any;
      message: string;
    }>("/public-users/join-meeting", {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        meetingId,
      } as JoinMeetingAsPublicUserRequest),
    });

    return response.data;
  }

  async leaveMeetingAsPublicUser(
    sessionId: string,
    meetingId: string
  ): Promise<void> {
    await this.request<{
      success: boolean;
      data: any;
      message: string;
    }>("/public-users/leave-meeting", {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        meetingId,
      } as LeaveMeetingAsPublicUserRequest),
    });
  }
}

// Export singleton instance
export const apiClient = new APIClient();

// Export types
export type { APIResponse, APIError, User, AuthResponse };
