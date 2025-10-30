import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import type { Meeting, Participant, User, PublicUser } from "$types";
import type { PeerConnection } from "$lib/webrtc-service";
import { logUserAction } from "$lib/errors";

// Extended types for meeting state
export interface MeetingParticipant extends Participant {
  isSpeaking?: boolean;
  audioLevel?: number;
  connectionState?: RTCPeerConnectionState;
  stream?: MediaStream;
}

export interface MediaState {
  isMicOn: boolean;
  isVideoOn: boolean;
  localStream: MediaStream | null;
  remoteStreams: { [key: string]: MediaStream };
  participantAudioLevels: { [key: string]: number };
  hasCameraPermission: boolean | null;
}

export interface WebRTCState {
  service: any; // WebRTCService instance
  peers: PeerConnection[];
  connectionStatus: "disconnected" | "connecting" | "connected";
  localPeerId: string | null;
}

export interface PublicUserState {
  isPublicUser: boolean;
  sessionId: string | null;
  userName: string;
  showModal: boolean;
}

export interface MeetingUIState {
  loading: boolean;
  error: string | null;
  isHydrated: boolean;
}

export interface MeetingState {
  // Meeting details
  meeting: Meeting | null;
  meetingId: string | null;

  // User info
  user: User | null;

  // Media state
  media: MediaState;

  // WebRTC state
  webrtc: WebRTCState;

  // Public user state
  publicUser: PublicUserState;

  // UI state
  ui: MeetingUIState;
}

// Initial state
const createInitialMeetingState = (): MeetingState => ({
  meeting: null,
  meetingId: null,
  user: null,
  media: {
    isMicOn: true,
    isVideoOn: true,
    localStream: null,
    remoteStreams: {},
    participantAudioLevels: {},
    hasCameraPermission: null,
  },
  webrtc: {
    service: null,
    peers: [],
    connectionStatus: "disconnected",
    localPeerId: null,
  },
  publicUser: {
    isPublicUser: false,
    sessionId: null,
    userName: "",
    showModal: false,
  },
  ui: {
    loading: true,
    error: null,
    isHydrated: false,
  },
});

// Create the meeting store
function createMeetingStore() {
  const initialState = createInitialMeetingState();
  const store = writable<MeetingState>(initialState);

  // Persistence key
  const PERSISTENCE_KEY = "gomeet_meeting_state";

  // State logging utility
  const logStateChange = (action: string, details?: any) => {
    console.log(`[Meeting Store] ${action}`, details ? details : "");

    // Log user action for analytics/debugging
    logUserAction(`meeting_${action}`, {
      meetingId: get(store).meetingId,
      timestamp: new Date().toISOString(),
      ...details,
    });
  };

  // State persistence
  const persistState = (state: MeetingState) => {
    if (!browser) return;

    try {
      // Only persist specific fields that should survive page refresh
      const persistableState = {
        publicUser: state.publicUser,
        media: {
          isMicOn: state.media.isMicOn,
          isVideoOn: state.media.isVideoOn,
        },
        meetingId: state.meetingId,
      };

      localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(persistableState));
      logStateChange("state_persisted", {
        keys: Object.keys(persistableState),
      });
    } catch (error) {
      console.error("[Meeting Store] Failed to persist state:", error);
    }
  };

  // State rehydration
  const rehydrateState = () => {
    if (!browser) return;

    try {
      const persistedData = localStorage.getItem(PERSISTENCE_KEY);
      if (persistedData) {
        const parsedState = JSON.parse(persistedData);
        logStateChange("state_rehydrated", { keys: Object.keys(parsedState) });

        store.update((current) => ({
          ...current,
          ...parsedState,
          ui: {
            ...current.ui,
            isHydrated: true,
          },
        }));

        return true;
      }
    } catch (error) {
      console.error("[Meeting Store] Failed to rehydrate state:", error);
    }

    // Mark as hydrated even if no persisted data
    store.update((current) => ({
      ...current,
      ui: {
        ...current.ui,
        isHydrated: true,
      },
    }));

    return false;
  };

  // Clear persisted state
  const clearPersistedState = () => {
    if (!browser) return;

    try {
      localStorage.removeItem(PERSISTENCE_KEY);
      logStateChange("persisted_state_cleared");
    } catch (error) {
      console.error("[Meeting Store] Failed to clear persisted state:", error);
    }
  };

  // Reset store to initial state
  const resetStore = () => {
    logStateChange("store_reset");
    store.update(() => createInitialMeetingState());
    clearPersistedState();
  };

  // Meeting actions
  const meetingActions = {
    setMeeting: (meeting: Meeting) => {
      logStateChange("meeting_set", {
        meetingId: meeting.id,
        title: meeting.title,
      });
      store.update((current) => ({
        ...current,
        meeting,
        meetingId: meeting.id,
      }));
      persistState(get(store));
    },

    setLoading: (loading: boolean) => {
      logStateChange("loading_changed", { loading });
      store.update((current) => ({
        ...current,
        ui: { ...current.ui, loading },
      }));
    },

    setError: (error: string | null) => {
      logStateChange("error_changed", { error });
      store.update((current) => ({
        ...current,
        ui: { ...current.ui, error },
      }));
    },

    clearError: () => {
      logStateChange("error_cleared");
      store.update((current) => ({
        ...current,
        ui: { ...current.ui, error: null },
      }));
    },
  };

  // User actions
  const userActions = {
    setUser: (user: User | null) => {
      logStateChange("user_set", { hasUser: !!user, userId: user?.id });
      store.update((current) => ({ ...current, user }));
    },
  };

  // Media actions
  const mediaActions = {
    setMediaState: (mediaState: Partial<MediaState>) => {
      logStateChange("media_state_changed", mediaState);
      store.update((current) => ({
        ...current,
        media: { ...current.media, ...mediaState },
      }));
      persistState(get(store));
    },

    setLocalStream: (stream: MediaStream | null) => {
      logStateChange("local_stream_set", { hasStream: !!stream });
      store.update((current) => ({
        ...current,
        media: { ...current.media, localStream: stream },
      }));
    },

    addRemoteStream: (peerId: string, stream: MediaStream) => {
      logStateChange("remote_stream_added", { peerId });
      store.update((current) => ({
        ...current,
        media: {
          ...current.media,
          remoteStreams: { ...current.media.remoteStreams, [peerId]: stream },
        },
      }));
    },

    removeRemoteStream: (peerId: string) => {
      logStateChange("remote_stream_removed", { peerId });
      store.update((current) => {
        const newRemoteStreams = { ...current.media.remoteStreams };
        delete newRemoteStreams[peerId];
        const newAudioLevels = { ...current.media.participantAudioLevels };
        delete newAudioLevels[peerId];

        return {
          ...current,
          media: {
            ...current.media,
            remoteStreams: newRemoteStreams,
            participantAudioLevels: newAudioLevels,
          },
        };
      });
    },

    updateAudioLevel: (participantId: string, level: number) => {
      store.update((current) => ({
        ...current,
        media: {
          ...current.media,
          participantAudioLevels: {
            ...current.media.participantAudioLevels,
            [participantId]: level,
          },
        },
      }));
    },

    toggleMic: () => {
      const current = get(store);
      const newState = !current.media.isMicOn;
      logStateChange("mic_toggled", { isMicOn: newState });
      store.update((current) => ({
        ...current,
        media: { ...current.media, isMicOn: newState },
      }));
      persistState(get(store));
    },

    toggleVideo: () => {
      const current = get(store);
      const newState = !current.media.isVideoOn;
      logStateChange("video_toggled", { isVideoOn: newState });
      store.update((current) => ({
        ...current,
        media: { ...current.media, isVideoOn: newState },
      }));
      persistState(get(store));
    },

    setCameraPermission: (hasPermission: boolean | null) => {
      logStateChange("camera_permission_set", { hasPermission });
      store.update((current) => ({
        ...current,
        media: { ...current.media, hasCameraPermission: hasPermission },
      }));
    },
  };

  // WebRTC actions
  const webrtcActions = {
    setWebRTCService: (service: any) => {
      logStateChange("webrtc_service_set", { hasService: !!service });
      store.update((current) => ({
        ...current,
        webrtc: { ...current.webrtc, service },
      }));
    },

    setConnectionStatus: (
      status: "disconnected" | "connecting" | "connected"
    ) => {
      logStateChange("connection_status_changed", { status });
      store.update((current) => ({
        ...current,
        webrtc: { ...current.webrtc, connectionStatus: status },
      }));
    },

    setLocalPeerId: (peerId: string | null) => {
      logStateChange("local_peer_id_set", { peerId });
      store.update((current) => ({
        ...current,
        webrtc: { ...current.webrtc, localPeerId: peerId },
      }));
    },

    addPeer: (peer: PeerConnection) => {
      logStateChange("peer_added", { peerId: peer.id, name: peer.name });
      store.update((current) => ({
        ...current,
        webrtc: {
          ...current.webrtc,
          peers: [...current.webrtc.peers, peer],
        },
      }));
    },

    removePeer: (peerId: string) => {
      logStateChange("peer_removed", { peerId });
      store.update((current) => ({
        ...current,
        webrtc: {
          ...current.webrtc,
          peers: current.webrtc.peers.filter((p) => p.id !== peerId),
        },
      }));
    },

    updatePeer: (peerId: string, updates: Partial<PeerConnection>) => {
      logStateChange("peer_updated", { peerId, updates });
      store.update((current) => ({
        ...current,
        webrtc: {
          ...current.webrtc,
          peers: current.webrtc.peers.map((p) =>
            p.id === peerId ? { ...p, ...updates } : p
          ),
        },
      }));
    },

    resetWebRTC: () => {
      logStateChange("webrtc_reset");
      store.update((current) => ({
        ...current,
        webrtc: {
          service: null,
          peers: [],
          connectionStatus: "disconnected",
          localPeerId: null,
        },
      }));
    },
  };

  // Public user actions
  const publicUserActions = {
    setPublicUser: (
      isPublicUser: boolean,
      sessionId: string | null = null,
      userName: string = ""
    ) => {
      logStateChange("public_user_set", { isPublicUser, sessionId, userName });
      store.update((current) => ({
        ...current,
        publicUser: {
          ...current.publicUser,
          isPublicUser,
          sessionId,
          userName,
        },
      }));
      persistState(get(store));
    },

    setShowModal: (show: boolean) => {
      logStateChange("public_user_modal_toggled", { show });
      store.update((current) => ({
        ...current,
        publicUser: {
          ...current.publicUser,
          showModal: show,
        },
      }));
    },

    setUserName: (userName: string) => {
      logStateChange("public_user_name_set", { userName });
      store.update((current) => ({
        ...current,
        publicUser: {
          ...current.publicUser,
          userName,
        },
      }));
      persistState(get(store));
    },
  };

  // Derived stores
  const derivedStores = {
    // Check if meeting is active
    isMeetingActive: derived(
      store,
      ($store) => $store.meeting?.isActive ?? false
    ),

    // Get participant count
    participantCount: derived(
      store,
      ($store) => $store.webrtc.peers.length + 1 // +1 for local user
    ),

    // Get all participants including local user
    allParticipants: derived(store, ($store) => {
      const participants: MeetingParticipant[] = [];

      // Add local participant
      if ($store.user || $store.publicUser.isPublicUser) {
        participants.push({
          id: "local",
          name: $store.user?.username || $store.publicUser.userName || "You",
          userId: $store.user?.id || "",
          joinedAt: new Date().toISOString(),
          isActive: true,
          isSpeaking: ($store.media.participantAudioLevels["local"] || 0) > 15,
          audioLevel: $store.media.participantAudioLevels["local"] || 0,
        });
      }

      // Add remote participants
      $store.webrtc.peers.forEach((peer) => {
        participants.push({
          id: peer.id,
          name: peer.name,
          userId: peer.id, // Using peer id as user id for WebRTC participants
          joinedAt: new Date().toISOString(), // This should come from peer data
          isActive: true,
          isSpeaking: ($store.media.participantAudioLevels[peer.id] || 0) > 15,
          audioLevel: $store.media.participantAudioLevels[peer.id] || 0,
          connectionState: peer.connection.connectionState,
          stream: peer.stream,
        });
      });

      return participants;
    }),

    // Check if user can join meeting
    canJoinMeeting: derived(store, ($store) => {
      return (
        !!$store.meeting &&
        !!$store.meetingId &&
        $store.media.hasCameraPermission !== false &&
        !$store.ui.loading
      );
    }),

    // Get connection quality indicator
    connectionQuality: derived(store, ($store) => {
      const connectedPeers = $store.webrtc.peers.filter(
        (p) => p.connection.connectionState === "connected"
      ).length;

      const totalPeers = $store.webrtc.peers.length;

      if (totalPeers === 0) return "excellent";
      if (connectedPeers === totalPeers) return "excellent";
      if (connectedPeers >= totalPeers * 0.7) return "good";
      if (connectedPeers >= totalPeers * 0.3) return "poor";
      return "disconnected";
    }),
  };

  // Initialize store with rehydration
  const initialize = () => {
    logStateChange("store_initializing");
    rehydrateState();
  };

  return {
    subscribe: store.subscribe,

    // Actions grouped by category
    meeting: meetingActions,
    user: userActions,
    media: mediaActions,
    webrtc: webrtcActions,
    publicUser: publicUserActions,

    // Derived stores
    isMeetingActive: derivedStores.isMeetingActive,
    participantCount: derivedStores.participantCount,
    allParticipants: derivedStores.allParticipants,
    canJoinMeeting: derivedStores.canJoinMeeting,
    connectionQuality: derivedStores.connectionQuality,

    // Utility methods
    initialize,
    reset: resetStore,
    clearPersisted: clearPersistedState,

    // Get current state (for debugging)
    getState: () => get(store),
  };
}

// Export singleton instance
export const meetingStore = createMeetingStore();

// Export types for external use
export type {
  MeetingState,
  MediaState,
  WebRTCState,
  PublicUserState,
  MeetingUIState,
};
