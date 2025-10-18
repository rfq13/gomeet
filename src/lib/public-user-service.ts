import { apiClient } from "./api-client";

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
    let sessionId = localStorage.getItem("public_session_id");
    if (!sessionId) {
      sessionId = this.generateSessionId();
      localStorage.setItem("public_session_id", sessionId);
    }
    return sessionId;
  }

  // Helper method to clear session ID
  clearSessionId(): void {
    localStorage.removeItem("public_session_id");
  }
}

export const publicUserService = new PublicUserService();
