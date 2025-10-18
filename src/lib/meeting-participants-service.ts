import { apiClient } from "./api-client";

export interface MeetingParticipant {
  id: string;
  name: string;
  userId?: string;
  publicUserId?: string;
  avatarUrl?: string;
  isActive: boolean;
  joinedAt: string;
  leftAt?: string;
  user?: {
    id: string;
    username: string;
    email: string;
    avatarUrl?: string;
  };
  publicUser?: {
    id: string;
    name: string;
    sessionId: string;
  };
}

export interface MeetingParticipantsResponse {
  participants: MeetingParticipant[];
  count: number;
}

class MeetingParticipantsService {
  private baseUrl = "/meetings";

  async getMeetingParticipants(
    meetingId: string
  ): Promise<MeetingParticipantsResponse> {
    try {
      const response = await apiClient.request<{
        success: boolean;
        data: MeetingParticipant[];
        message: string;
      }>(`${this.baseUrl}/${meetingId}/participants/public`);
      return {
        participants: response.data || [],
        count: response.data?.length || 0,
      };
    } catch (error) {
      console.error("Error fetching meeting participants:", error);
      throw error;
    }
  }

  // Transform participant data for UI display
  transformParticipantForDisplay(participant: MeetingParticipant): {
    id: string;
    name: string;
    isLocalUser: boolean;
    isPublicUser: boolean;
    avatarUrl?: string;
  } {
    const currentUserId = this.getCurrentUserId();
    const isLocalUser =
      participant.userId === currentUserId ||
      participant.publicUser?.sessionId === this.getCurrentSessionId();

    return {
      id: participant.id,
      name:
        participant.name ||
        participant.user?.username ||
        participant.user?.email ||
        participant.publicUser?.name ||
        "Unknown Participant",
      isLocalUser,
      isPublicUser: !!participant.publicUserId,
      avatarUrl: participant.avatarUrl || participant.user?.avatarUrl,
    };
  }

  private getCurrentUserId(): string | null {
    if (typeof window !== "undefined") {
      return localStorage.getItem("userId");
    }
    return null;
  }

  private getCurrentSessionId(): string | null {
    if (typeof window !== "undefined") {
      return localStorage.getItem("public_session_id");
    }
    return null;
  }
}

export const meetingParticipantsService = new MeetingParticipantsService();
