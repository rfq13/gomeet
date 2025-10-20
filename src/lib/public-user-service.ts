"use client";
import { apiClient } from "./api-client";
import {
  safeGetLocalStorageItem,
  safeSetLocalStorageItem,
  safeRemoveLocalStorageItem,
} from "./storage-utils";

export interface PublicUser {
  id: string;
  name: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePublicUserRequest {
  name: string;
  sessionId: string;
}

export interface JoinMeetingAsPublicUserRequest {
  name: string;
  sessionId: string;
  meetingId: string;
}

export interface LeaveMeetingAsPublicUserRequest {
  sessionId: string;
  meetingId: string;
}

export class PublicUserService {
  private apiClient = apiClient;

  async createPublicUser(data: CreatePublicUserRequest): Promise<PublicUser> {
    const response = await this.apiClient.request<{
      success: boolean;
      data: PublicUser;
      message: string;
    }>("/public-users", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return response.data;
  }

  async joinMeetingAsPublicUser(
    data: JoinMeetingAsPublicUserRequest
  ): Promise<void> {
    await this.apiClient.request("/public-users/join-meeting", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async leaveMeetingAsPublicUser(
    data: LeaveMeetingAsPublicUserRequest
  ): Promise<void> {
    await this.apiClient.request("/public-users/leave-meeting", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getPublicUserBySessionId(
    sessionId: string
  ): Promise<PublicUser | null> {
    try {
      const response = await this.apiClient.request<{
        success: boolean;
        data: PublicUser;
        message: string;
      }>(`/public-users/session/${sessionId}`, {
        method: "GET",
      });
      return response.data;
    } catch (error: any) {
      // If user not found (404) or any other error, return null
      if (error?.status === 404) {
        console.log("Public user not found for session ID:", sessionId);
      } else {
        console.error("Error getting public user by session ID:", error);
      }
      return null;
    }
  }

  // Helper method to generate a session ID
  generateSessionId(): string {
    return (
      "session_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now()
    );
  }

  // Helper method to get or create session ID from localStorage
  getOrCreateSessionId(): string {
    // Check if we're in browser environment
    if (typeof window === "undefined") {
      // Return a temporary session ID for server-side rendering
      return this.generateSessionId();
    }

    // DEBUG LOGGING: Check localStorage availability
    console.log(
      "[DEBUG] Public User Service - Window available:",
      typeof window !== "undefined"
    );
    console.log(
      "[DEBUG] Public User Service - localStorage available:",
      typeof localStorage !== "undefined"
    );
    console.log(
      "[DEBUG] Public User Service - localStorage.getItem type:",
      typeof localStorage?.getItem
    );
    console.log(
      "[DEBUG] Public User Service - localStorage.setItem type:",
      typeof localStorage?.setItem
    );

    if (
      typeof localStorage !== "undefined" &&
      typeof localStorage.getItem === "function"
    ) {
      let sessionId = localStorage.getItem("public_session_id");
      console.log(
        "[DEBUG] Public User Service - Existing session ID:",
        !!sessionId
      );

      if (!sessionId) {
        sessionId = this.generateSessionId();
        if (typeof localStorage.setItem === "function") {
          localStorage.setItem("public_session_id", sessionId);
          console.log("[DEBUG] Public User Service - New session ID saved");
        } else {
          console.log(
            "[DEBUG] Public User Service - localStorage.setItem is not a function!"
          );
        }
      }
      return sessionId;
    } else {
      console.log(
        "[DEBUG] Public User Service - localStorage.getItem is not a function!"
      );
      return this.generateSessionId();
    }
  }

  // Helper method to clear session ID
  clearSessionId(): void {
    safeRemoveLocalStorageItem("public_session_id");
  }
}

export const publicUserService = new PublicUserService();
