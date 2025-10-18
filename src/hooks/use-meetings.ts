import { useState, useEffect, useCallback } from "react";
import {
  meetingService,
  Meeting,
  MeetingListResponse,
  CreateMeetingRequest,
  UpdateMeetingRequest,
  MeetingParams,
} from "@/lib/meeting-service";
import { APIException } from "@/lib/api-client";
import { useAuthContext } from "@/contexts/auth-context";

interface UseMeetingsState {
  meetings: Meeting[];
  loading: boolean;
  error: string | null;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface UseMeetingsActions {
  createMeeting: (data: CreateMeetingRequest) => Promise<void>;
  updateMeeting: (id: string, data: UpdateMeetingRequest) => Promise<void>;
  deleteMeeting: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export function useMeetings(
  params?: MeetingParams
): UseMeetingsState & UseMeetingsActions {
  const [state, setState] = useState<UseMeetingsState>({
    meetings: [],
    loading: true,
    error: null,
    pagination: {
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    },
  });

  const [currentParams, setCurrentParams] = useState<MeetingParams>({
    page: 1,
    limit: 10,
    ...params,
  });

  // Fungsi untuk memperbarui state
  const updateState = useCallback((updates: Partial<UseMeetingsState>) => {
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

  // Fetch meetings
  const fetchMeetings = useCallback(
    async (newParams?: MeetingParams) => {
      try {
        updateState({ loading: true, error: null });

        const paramsToUse = newParams || currentParams;
        const response = await meetingService.getMeetings(paramsToUse);

        if (newParams?.page && newParams.page > 1) {
          // Append for pagination
          setState((prev) => ({
            ...prev,
            meetings: [...prev.meetings, ...response.meetings],
            pagination: response.pagination,
            loading: false,
          }));
        } else {
          // Replace for initial load or refresh
          updateState({
            meetings: response.meetings,
            pagination: response.pagination,
            loading: false,
          });
        }

        setCurrentParams(paramsToUse);
      } catch (error) {
        handleError(error);
      }
    },
    [currentParams, updateState, handleError]
  );

  // Initial fetch
  useEffect(() => {
    fetchMeetings();
  }, []);

  // Refetch function
  const refetch = useCallback(async () => {
    await fetchMeetings({ page: 1, limit: 10, ...params });
  }, [fetchMeetings, params]);

  // Load more function
  const loadMore = useCallback(async () => {
    if (state.pagination.page < state.pagination.totalPages && !state.loading) {
      await fetchMeetings({
        ...currentParams,
        page: state.pagination.page + 1,
      });
    }
  }, [
    state.pagination.page,
    state.pagination.totalPages,
    state.loading,
    currentParams,
    fetchMeetings,
  ]);

  // Create meeting
  const createMeeting = useCallback(
    async (data: CreateMeetingRequest) => {
      try {
        updateState({ loading: true, error: null });

        const newMeeting = await meetingService.createMeeting(data);

        // Add new meeting to the list
        setState((prev) => ({
          ...prev,
          meetings: [newMeeting, ...prev.meetings],
          loading: false,
        }));
      } catch (error) {
        handleError(error);
      }
    },
    [updateState, handleError]
  );

  // Update meeting
  const updateMeeting = useCallback(
    async (id: string, data: UpdateMeetingRequest) => {
      try {
        updateState({ loading: true, error: null });

        const updatedMeeting = await meetingService.updateMeeting(id, data);

        // Update meeting in the list
        setState((prev) => ({
          ...prev,
          meetings: prev.meetings.map((meeting) =>
            meeting.id === id ? updatedMeeting : meeting
          ),
          loading: false,
        }));
      } catch (error) {
        handleError(error);
      }
    },
    [updateState, handleError]
  );

  // Delete meeting
  const deleteMeeting = useCallback(
    async (id: string) => {
      try {
        updateState({ loading: true, error: null });

        await meetingService.deleteMeeting(id);

        // Remove meeting from the list
        setState((prev) => ({
          ...prev,
          meetings: prev.meetings.filter((meeting) => meeting.id !== id),
          loading: false,
        }));
      } catch (error) {
        handleError(error);
      }
    },
    [updateState, handleError]
  );

  return {
    ...state,
    createMeeting,
    updateMeeting,
    deleteMeeting,
    refetch,
    loadMore,
  };
}

// Hook for single meeting
export function useMeeting(meetingId: string) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated } = useAuthContext();

  const fetchMeeting = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let meetingData;
      if (isAuthenticated) {
        meetingData = await meetingService.getMeeting(meetingId);
      } else {
        meetingData = await meetingService.getMeetingPublic(meetingId);
      }

      setMeeting(meetingData);
    } catch (error) {
      if (error instanceof APIException) {
        setError(error.error.message);
      } else {
        setError(
          error instanceof Error ? error.message : "An unknown error occurred"
        );
      }
    } finally {
      setLoading(false);
    }
  }, [meetingId, isAuthenticated]);

  // Join meeting
  const joinMeeting = useCallback(async () => {
    try {
      await meetingService.joinMeeting(meetingId);
      // Refresh meeting data after joining
      await fetchMeeting();
    } catch (error) {
      if (error instanceof APIException) {
        setError(error.error.message);
      } else {
        setError(
          error instanceof Error ? error.message : "Failed to join meeting"
        );
      }
    }
  }, [meetingId, fetchMeeting]);

  // Leave meeting
  const leaveMeeting = useCallback(async () => {
    try {
      await meetingService.leaveMeeting(meetingId);
      // Refresh meeting data after leaving
      await fetchMeeting();
    } catch (error) {
      if (error instanceof APIException) {
        setError(error.error.message);
      } else {
        setError(
          error instanceof Error ? error.message : "Failed to leave meeting"
        );
      }
    }
  }, [meetingId, fetchMeeting]);

  useEffect(() => {
    if (meetingId) {
      fetchMeeting();
    }
  }, [meetingId, fetchMeeting]);

  return {
    meeting,
    loading,
    error,
    refetch: fetchMeeting,
    joinMeeting,
    leaveMeeting,
  };
}
