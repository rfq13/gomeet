import { apiClient, APIException, User } from "./api-client";

// Meeting interfaces sesuai dengan backend
export interface Participant {
  name: string;
  id: string;
  userId: string;
  joinedAt: string;
  leftAt?: string;
  isActive: boolean;
}

export interface Meeting {
  id: string;
  title: string;
  description?: string;
  hostId: string;
  hostName: string;
  startTime: string;
  duration: number;
  meetingLink: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  participants?: Participant[];
}

export interface CreateMeetingRequest {
  name: string;
  description?: string;
  startTime: string;
  duration: number;
}

export interface UpdateMeetingRequest {
  title?: string;
  description?: string;
  startTime?: string;
  duration?: number;
}

export interface MeetingListResponse {
  meetings: Meeting[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface MeetingParams {
  page?: number;
  limit?: number;
  search?: string;
}

// Meeting service untuk mengelola meeting operations
export class MeetingService {
  // Mendapatkan daftar meetings
  async getMeetings(params?: MeetingParams): Promise<MeetingListResponse> {
    try {
      const queryParams = new URLSearchParams();

      if (params?.page) queryParams.append("page", params.page.toString());
      if (params?.limit) queryParams.append("limit", params.limit.toString());
      if (params?.search) queryParams.append("search", params.search);

      const endpoint = `/meetings${
        queryParams.toString() ? `?${queryParams.toString()}` : ""
      }`;

      const response = await apiClient.request<{
        success: boolean;
        data: MeetingListResponse;
      }>(endpoint);

      return response.data;
    } catch (error) {
      if (error instanceof APIException) {
        throw error;
      }
      throw new APIException({
        code: "GET_MEETINGS_ERROR",
        message: "Failed to fetch meetings",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Mendapatkan detail meeting
  async getMeeting(id: string): Promise<Meeting> {
    try {
      const response = await apiClient.request<{
        success: boolean;
        data: Meeting;
      }>(`/meetings/${id}`);

      return response.data;
    } catch (error) {
      if (error instanceof APIException) {
        throw error;
      }
      throw new APIException({
        code: "GET_MEETING_ERROR",
        message: "Failed to fetch meeting details",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Mendapatkan detail meeting publik (tanpa auth)
  async getMeetingPublic(id: string): Promise<Meeting> {
    try {
      const response = await apiClient.request<{
        success: boolean;
        data: Meeting;
      }>(`/meetings/${id}/public`);

      return response.data;
    } catch (error) {
      if (error instanceof APIException) {
        throw error;
      }
      throw new APIException({
        code: "GET_MEETING_PUBLIC_ERROR",
        message: "Failed to fetch meeting details",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Membuat meeting baru
  async createMeeting(data: CreateMeetingRequest): Promise<Meeting> {
    try {
      const response = await apiClient.request<{
        success: boolean;
        data: Meeting;
      }>("/meetings", {
        method: "POST",
        body: JSON.stringify(data),
      });

      return response.data;
    } catch (error) {
      if (error instanceof APIException) {
        throw error;
      }
      throw new APIException({
        code: "CREATE_MEETING_ERROR",
        message: "Failed to create meeting",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Update meeting
  async updateMeeting(
    id: string,
    data: UpdateMeetingRequest
  ): Promise<Meeting> {
    try {
      const response = await apiClient.request<{
        success: boolean;
        data: Meeting;
      }>(`/meetings/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });

      return response.data;
    } catch (error) {
      if (error instanceof APIException) {
        throw error;
      }
      throw new APIException({
        code: "UPDATE_MEETING_ERROR",
        message: "Failed to update meeting",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Menghapus meeting
  async deleteMeeting(id: string): Promise<void> {
    try {
      await apiClient.request(`/meetings/${id}`, {
        method: "DELETE",
      });
    } catch (error) {
      if (error instanceof APIException) {
        throw error;
      }
      throw new APIException({
        code: "DELETE_MEETING_ERROR",
        message: "Failed to delete meeting",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Join meeting
  async joinMeeting(meetingId: string): Promise<void> {
    try {
      await apiClient.request("/meetings/join", {
        method: "POST",
        body: JSON.stringify({ meetingId }),
      });
    } catch (error) {
      if (error instanceof APIException) {
        throw error;
      }
      throw new APIException({
        code: "JOIN_MEETING_ERROR",
        message: "Failed to join meeting",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Leave meeting
  async leaveMeeting(meetingId: string): Promise<void> {
    try {
      await apiClient.request("/meetings/leave", {
        method: "POST",
        body: JSON.stringify({ meetingId }),
      });
    } catch (error) {
      if (error instanceof APIException) {
        throw error;
      }
      throw new APIException({
        code: "LEAVE_MEETING_ERROR",
        message: "Failed to leave meeting",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

// Export singleton instance
export const meetingService = new MeetingService();
