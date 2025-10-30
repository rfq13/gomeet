/**
 * Meeting Store Integration Example
 *
 * This file shows how to integrate the new meeting state store
 * with the existing meeting component with minimal changes.
 */

import { onMount, onDestroy } from "svelte";
import { page } from "$app/state";
import { goto } from "$app/navigation";
import {
  createMeetingCompatAdapter,
  type MeetingCompatAdapter,
} from "./meeting-compat";
import { PublicUserModal } from "$components";
import type { Meeting } from "$types";

/**
 * Integration hook for meeting component
 * This provides the same interface as the original meeting component
 * but uses the new centralized state store underneath.
 */
export function useMeetingIntegration() {
  // Get meeting ID from URL params
  const meetingId = page.params.id as string;

  // Create compatibility adapter
  let adapter: MeetingCompatAdapter;
  let state: any = {};

  // Initialize adapter
  onMount(() => {
    const initialize = async () => {
      try {
        console.log("[Meeting Integration] Initializing...");

        // Create and initialize adapter
        adapter = createMeetingCompatAdapter(meetingId);
        await adapter.initialize();

        // Subscribe to state changes
        const unsubscribe = adapter.subscribe((newState) => {
          state = newState;
        });

        // Set up page lifecycle handlers
        const handleVisibilityChange = () => {
          if (adapter) {
            // Handle visibility changes
            console.log("[Meeting Integration] Visibility changed");
          }
        };

        const handleBeforeUnload = () => {
          if (adapter) {
            adapter.destroy();
          }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("beforeunload", handleBeforeUnload);

        // Cleanup function
        return () => {
          unsubscribe();
          document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange
          );
          window.removeEventListener("beforeunload", handleBeforeUnload);
          if (adapter) {
            adapter.destroy();
          }
        };
      } catch (error) {
        console.error("[Meeting Integration] Initialization failed:", error);
      }
    };

    initialize();
  });

  return {
    // State (same as original component)
    get state() {
      return state;
    },

    // Methods (same as original component)
    loadMeeting: () => adapter?.loadMeeting(),
    checkPublicUserSession: () => adapter?.checkPublicUserSession(),
    handlePublicUserSubmit: (name: string) =>
      adapter?.handlePublicUserSubmit(name),
    leaveMeetingAsPublicUser: () => adapter?.leaveMeetingAsPublicUser(),
    initializeWebRTC: () => adapter?.initializeWebRTC(),
    setupMediaDevices: () => adapter?.setupMediaDevices(),
    toggleMic: () => adapter?.toggleMic(),
    toggleVideo: () => adapter?.toggleVideo(),
    hangUp: () => {
      adapter?.hangUp();
      goto("/dashboard");
    },
    generateSessionId: () => adapter?.generateSessionId(),
    getAudioLevel: (level: number) => adapter?.getAudioLevel(level) || "low",
    isSpeaking: (level: number) => adapter?.isSpeaking(level) || false,
    stopAllMediaTracks: () => adapter?.stopAllMediaTracks(),
    cleanupAudio: () => adapter?.cleanupAudio(),
  };
}

/**
 * Svelte component integration helper
 * This can be used to gradually migrate existing components
 */
export function createMeetingComponentIntegration(meetingId: string) {
  const adapter = createMeetingCompatAdapter(meetingId);

  // Reactive state variables (same as original component)
  let webrtcService = $state<any>(null);
  let peers = $state<any[]>([]);
  let connectionStatus = $state<"disconnected" | "connecting" | "connected">(
    "disconnected"
  );
  let user = $state<any>(null);
  let meeting = $state<Meeting | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let hasCameraPermission = $state<boolean | null>(null);
  let showPublicUserModal = $state(false);
  let publicSessionId = $state<string | null>(null);
  let publicUserName = $state("");
  let isPublicUser = $state(false);
  let isMicOn = $state(true);
  let isVideoOn = $state(true);
  let localStream = $state<MediaStream | null>(null);
  let remoteStreams = $state<{ [key: string]: MediaStream }>({});
  let participantAudioLevels = $state<{ [key: string]: number }>({});

  // Initialize and subscribe to adapter
  let unsubscribe: (() => void) | null = null;

  const initialize = async () => {
    try {
      await adapter.initialize();

      unsubscribe = adapter.subscribe((newState) => {
        // Update reactive variables
        webrtcService = newState.webrtcService;
        peers = newState.peers || [];
        connectionStatus = newState.connectionStatus || "disconnected";
        user = newState.user;
        meeting = newState.meeting;
        loading = newState.loading || false;
        error = newState.error;
        hasCameraPermission = newState.hasCameraPermission;
        showPublicUserModal = newState.showPublicUserModal || false;
        publicSessionId = newState.publicSessionId;
        publicUserName = newState.publicUserName || "";
        isPublicUser = newState.isPublicUser || false;
        isMicOn = newState.isMicOn ?? true;
        isVideoOn = newState.isVideoOn ?? true;
        localStream = newState.localStream;
        remoteStreams = newState.remoteStreams || {};
        participantAudioLevels = newState.participantAudioLevels || {};
      });
    } catch (error) {
      console.error("[Meeting Integration] Failed to initialize:", error);
      error = error instanceof Error ? error.message : "Initialization failed";
    }
  };

  const destroy = () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    adapter.destroy();
  };

  return {
    // Reactive state (same as original component)
    webrtcService,
    peers,
    connectionStatus,
    user,
    meeting,
    loading,
    error,
    hasCameraPermission,
    showPublicUserModal,
    publicSessionId,
    publicUserName,
    isPublicUser,
    isMicOn,
    isVideoOn,
    localStream,
    remoteStreams,
    participantAudioLevels,

    // Methods (same as original component)
    initialize,
    destroy,
    loadMeeting: () => adapter.loadMeeting(),
    checkPublicUserSession: () => adapter.checkPublicUserSession(),
    handlePublicUserSubmit: (name: string) =>
      adapter.handlePublicUserSubmit(name),
    leaveMeetingAsPublicUser: () => adapter.leaveMeetingAsPublicUser(),
    initializeWebRTC: () => adapter.initializeWebRTC(),
    setupMediaDevices: () => adapter.setupMediaDevices(),
    toggleMic: () => adapter.toggleMic(),
    toggleVideo: () => adapter.toggleVideo(),
    hangUp: async () => {
      await adapter.hangUp();
      goto("/dashboard");
    },
    generateSessionId: () => adapter.generateSessionId(),
    getAudioLevel: (level: number) => adapter.getAudioLevel(level),
    isSpeaking: (level: number) => adapter.isSpeaking(level),
    stopAllMediaTracks: () => adapter.stopAllMediaTracks(),
    cleanupAudio: () => adapter.cleanupAudio(),
  };
}

/**
 * Template integration helper
 * This shows how to use the integration in Svelte templates
 */
export function createTemplateIntegration(
  integration: ReturnType<typeof createMeetingComponentIntegration>
) {
  return {
    // Computed values for template
    get participantCount() {
      return integration.peers.length + 1;
    },

    get isMeetingReady() {
      return (
        !integration.loading &&
        integration.meeting &&
        integration.hasCameraPermission !== false
      );
    },

    get localUserName() {
      return (
        integration.user?.username ||
        integration.user?.email ||
        integration.publicUserName ||
        "You"
      );
    },

    get showVideoPlaceholder() {
      return !integration.localStream || !integration.isVideoOn;
    },

    // Audio level helpers
    getLocalAudioLevel() {
      return integration.participantAudioLevels["local"] || 0;
    },

    getRemoteAudioLevel(peerId: string) {
      return integration.participantAudioLevels[peerId] || 0;
    },

    getLocalAudioLevelClass() {
      const level = this.getLocalAudioLevel();
      return integration.getAudioLevel(level);
    },

    getRemoteAudioLevelClass(peerId: string) {
      const level = this.getRemoteAudioLevel(peerId);
      return integration.getAudioLevel(level);
    },

    isLocalSpeaking() {
      return integration.isSpeaking(this.getLocalAudioLevel());
    },

    isRemoteSpeaking(peerId: string) {
      return integration.isSpeaking(this.getRemoteAudioLevel(peerId));
    },

    // Status helpers
    getConnectionStatusClass() {
      switch (integration.connectionStatus) {
        case "connected":
          return "text-green-500";
        case "connecting":
          return "text-yellow-500";
        default:
          return "text-red-500";
      }
    },

    getMicButtonClass() {
      return integration.isMicOn
        ? "bg-slate-700 hover:bg-slate-600"
        : "bg-red-600 hover:bg-red-700";
    },

    getVideoButtonClass() {
      return integration.isVideoOn
        ? "bg-slate-700 hover:bg-slate-600"
        : "bg-red-600 hover:bg-red-700";
    },
  };
}

/**
 * Complete integration example
 * This shows how to use everything together in a component
 */
export function useCompleteMeetingIntegration() {
  const meetingId = page.params.id as string;
  const integration = createMeetingComponentIntegration(meetingId);
  const template = createTemplateIntegration(integration);

  // Initialize on mount
  onMount(() => {
    integration.initialize();
  });

  // Cleanup on destroy
  onDestroy(() => {
    integration.destroy();
  });

  return {
    // Integration
    integration,
    template,

    // Convenience methods
    get state() {
      return integration;
    },

    get helpers() {
      return template;
    },
  };
}
