import { useState, useEffect, useCallback } from "react";
import {
  meetingParticipantsService,
  MeetingParticipant,
  MeetingParticipantsResponse,
} from "@/lib/meeting-participants-service";

export interface DisplayParticipant {
  id: string;
  name: string;
  isLocalUser: boolean;
  isPublicUser: boolean;
  avatarUrl?: string;
}

export const useMeetingParticipants = (
  meetingId: string,
  currentUserId?: string,
  isPublicUser?: boolean
) => {
  const [participants, setParticipants] = useState<DisplayParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchParticipants = useCallback(async () => {
    if (!meetingId) return;

    try {
      setLoading(true);
      setError(null);

      const response: MeetingParticipantsResponse =
        await meetingParticipantsService.getMeetingParticipants(meetingId);

      // Transform participants for display
      const displayParticipants: DisplayParticipant[] =
        response.participants.map((participant) =>
          meetingParticipantsService.transformParticipantForDisplay(participant)
        );

      setParticipants(displayParticipants);
    } catch (err) {
      console.error("Error fetching meeting participants:", err);
      setError(
        err instanceof Error ? err.message : "Failed to fetch participants"
      );
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  // Add local user to participants list if not already included
  const getParticipantsWithLocalUser = useCallback(
    (localUserName?: string): DisplayParticipant[] => {
      const localUser: DisplayParticipant = {
        id: currentUserId || "local-user",
        name: localUserName || "You",
        isLocalUser: true,
        isPublicUser: isPublicUser || false,
      };

      // Check if local user is already in the list
      const localUserExists = participants.some((p) => p.isLocalUser);

      if (localUserExists) {
        return participants;
      }

      // Add local user at the beginning of the list
      return [localUser, ...participants];
    },
    [participants, currentUserId, isPublicUser]
  );

  // Get total participant count (including local user)
  const getParticipantCount = useCallback(
    (localUserName?: string): number => {
      return getParticipantsWithLocalUser(localUserName).length;
    },
    [getParticipantsWithLocalUser]
  );

  // Refresh participants
  const refreshParticipants = useCallback(() => {
    fetchParticipants();
  }, [fetchParticipants]);

  // Auto-refresh participants every 30 seconds
  useEffect(() => {
    fetchParticipants();

    const interval = setInterval(() => {
      fetchParticipants();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [fetchParticipants]);

  return {
    participants,
    loading,
    error,
    getParticipantsWithLocalUser,
    getParticipantCount,
    refreshParticipants,
  };
};
