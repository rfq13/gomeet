import { apiClient, APIException } from "./api-client";
import { cacheManager } from "./cache";
import type {
  Meeting,
  Participant,
  CreateMeetingRequest,
  UpdateMeetingRequest,
  MeetingListResponse,
  MeetingParams,
} from "$types";

// Meeting service untuk mengelola meeting operations
export class MeetingService {
  // Mendapatkan daftar meetings
  async getMeetings(
    params?: MeetingParams,
    useCache: boolean = true
  ): Promise<MeetingListResponse> {
    try {
      // Try to get from cache first
      const paramsString = params ? JSON.stringify(params) : "";
      if (useCache) {
        const cachedData = cacheManager.getCachedMeetingList(paramsString);
        if (cachedData) {
          return cachedData;
        }
      }

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

      // Cache the response
      cacheManager.cacheMeetingList(response.data, paramsString);

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
  async getMeeting(id: string, useCache: boolean = true): Promise<Meeting> {
    try {
      // Try to get from cache first
      if (useCache) {
        const cachedMeeting = cacheManager.getCachedMeetingDetail(id);
        if (cachedMeeting) {
          return cachedMeeting;
        }
      }

      const response = await apiClient.request<{
        success: boolean;
        data: Meeting;
      }>(`/meetings/${id}`);

      // Cache the response
      cacheManager.cacheMeetingDetail(response.data);

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
  async getMeetingPublic(
    id: string,
    useCache: boolean = true
  ): Promise<Meeting> {
    try {
      // Try to get from cache first
      if (useCache) {
        const cachedMeeting = cacheManager.getCachedMeetingPublic(id);
        if (cachedMeeting) {
          return cachedMeeting;
        }
      }

      const response = await apiClient.request<{
        success: boolean;
        data: Meeting;
      }>(`/meetings/${id}/public`);

      // Cache the response
      cacheManager.cacheMeetingPublic(response.data);

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

      // Invalidate meeting list cache since new meeting is created
      cacheManager.invalidateAllMeetings();

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

      // Invalidate cache for this specific meeting and all meeting lists
      cacheManager.invalidateMeeting(id);

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

      // Invalidate cache for this specific meeting and all meeting lists
      cacheManager.invalidateMeeting(id);
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
