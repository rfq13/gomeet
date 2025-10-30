/**
 * Meeting Store Compatibility Layer
 *
 * This file provides backward compatibility utilities to help migrate
 * existing meeting components to use the new centralized state store
 * without breaking existing functionality.
 */

import { get } from "svelte/store";
import { meetingStore } from "./meeting.store";
import {
  createDefaultMeetingManager,
  type MeetingManager,
} from "./meeting-manager";
import { authStore } from "./auth.store";
import type { Meeting, User, PublicUser } from "$types";
import type { PeerConnection } from "$lib/webrtc-service";

/**
 * Compatibility adapter that provides the same interface as the old
 * scattered state variables but uses the centralized store underneath.
 */
export class MeetingCompatAdapter {
  private meetingManager: MeetingManager | null = null;
  private meetingId: string;

  constructor(meetingId: string) {
    this.meetingId = meetingId;
    console.log("[Meeting Compat] Initialized for meeting:", meetingId);
  }

  /**
   * Initialize the compatibility adapter
   */
  async initialize(): Promise<void> {
    try {
      console.log("[Meeting Compat] Initializing...");

      // Create meeting manager
      this.meetingManager = createDefaultMeetingManager(this.meetingId);

      // Initialize meeting manager
      await this.meetingManager.initialize();

      console.log("[Meeting Compat] Initialized successfully");
    } catch (error) {
      console.error("[Meeting Compat] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Get current state in the old format for backward compatibility
   */
  getCompatState() {
    const state = meetingStore.getState();

    return {
      // Meeting state (old format)
      meeting: state.meeting,
      loading: state.ui.loading,
      error: state.ui.error,

      // User state (old format)
      user: state.user,

      // Public user state (old format)
      showPublicUserModal: state.publicUser.showModal,
      publicSessionId: state.publicUser.sessionId,
      publicUserName: state.publicUser.userName,
      isPublicUser: state.publicUser.isPublicUser,

      // WebRTC state (old format)
      webrtcService: state.webrtc.service,
      peers: state.webrtc.peers,
      connectionStatus: state.webrtc.connectionStatus,

      // Media state (old format)
      isMicOn: state.media.isMicOn,
      isVideoOn: state.media.isVideoOn,
      localStream: state.media.localStream,
      remoteStreams: state.media.remoteStreams,
      participantAudioLevels: state.media.participantAudioLevels,
      hasCameraPermission: state.media.hasCameraPermission,
    };
  }

  /**
   * Subscribe to state changes (Svelte store compatible)
   */
  subscribe(callback: (state: any) => void) {
    return meetingStore.subscribe((storeState) => {
      callback(this.getCompatState());
    });
  }

  /**
   * Legacy methods for backward compatibility
   */

  // Meeting methods
  async loadMeeting(): Promise<void> {
    // This is now handled automatically by the meeting manager
    console.log(
      "[Meeting Compat] loadMeeting() called - now handled by meeting manager"
    );
  }

  async checkPublicUserSession(): Promise<void> {
    // This is now handled automatically by the meeting manager
    console.log(
      "[Meeting Compat] checkPublicUserSession() called - now handled by meeting manager"
    );
  }

  async handlePublicUserSubmit(name: string): Promise<void> {
    if (this.meetingManager) {
      await this.meetingManager.joinAsPublicUser(name);
    }
  }

  async leaveMeetingAsPublicUser(): Promise<void> {
    // This is now handled by the meeting manager
    console.log(
      "[Meeting Compat] leaveMeetingAsPublicUser() called - now handled by meeting manager"
    );
  }

  // WebRTC methods
  async initializeWebRTC(): Promise<void> {
    if (this.meetingManager) {
      await this.meetingManager.initializeWebRTC();
    }
  }

  // Media methods
  async setupMediaDevices(): Promise<void> {
    // This is now handled automatically by the meeting manager
    console.log(
      "[Meeting Compat] setupMediaDevices() called - now handled by meeting manager"
    );
  }

  async toggleMic(): Promise<void> {
    if (this.meetingManager) {
      await this.meetingManager.toggleMicrophone();
    }
  }

  async toggleVideo(): Promise<void> {
    if (this.meetingManager) {
      await this.meetingManager.toggleVideo();
    }
  }

  async hangUp(): Promise<void> {
    if (this.meetingManager) {
      await this.meetingManager.leaveMeeting();
    }
  }

  // Utility methods
  generateSessionId(): string {
    return "pub_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now();
  }

  getAudioLevel(level: number): string {
    const normalized = Math.min(level / 50, 1);
    if (normalized > 0.3) return "high";
    if (normalized > 0.15) return "medium";
    return "low";
  }

  isSpeaking(level: number): boolean {
    return level > 15;
  }

  // Cleanup methods
  stopAllMediaTracks(): void {
    // This is now handled by the meeting manager
    console.log(
      "[Meeting Compat] stopAllMediaTracks() called - now handled by meeting manager"
    );
  }

  cleanupAudio(): void {
    // This is now handled by the meeting manager
    console.log(
      "[Meeting Compat] cleanupAudio() called - now handled by meeting manager"
    );
  }

  /**
   * Destroy the adapter and clean up resources
   */
  destroy(): void {
    console.log("[Meeting Compat] Destroying...");

    if (this.meetingManager) {
      this.meetingManager.destroy();
      this.meetingManager = null;
    }
  }
}

/**
 * Factory function to create compatibility adapter
 */
export function createMeetingCompatAdapter(
  meetingId: string
): MeetingCompatAdapter {
  return new MeetingCompatAdapter(meetingId);
}

/**
 * Migration helper functions
 */

/**
 * Migrate existing component to use new state store
 * This function helps gradually migrate from old state to new store
 */
export function migrateToNewStore(oldState: any) {
  console.log("[Meeting Compat] Migrating state to new store...");

  const state = meetingStore.getState();

  // Update meeting store with old state values
  if (oldState.meeting) {
    meetingStore.meeting.setMeeting(oldState.meeting);
  }

  if (oldState.user) {
    meetingStore.user.setUser(oldState.user);
  }

  if (oldState.isMicOn !== undefined) {
    meetingStore.media.setMediaState({ isMicOn: oldState.isMicOn });
  }

  if (oldState.isVideoOn !== undefined) {
    meetingStore.media.setMediaState({ isVideoOn: oldState.isVideoOn });
  }

  if (oldState.localStream) {
    meetingStore.media.setLocalStream(oldState.localStream);
  }

  if (oldState.remoteStreams) {
    Object.keys(oldState.remoteStreams).forEach((peerId) => {
      meetingStore.media.addRemoteStream(
        peerId,
        oldState.remoteStreams[peerId]
      );
    });
  }

  if (oldState.participantAudioLevels) {
    Object.keys(oldState.participantAudioLevels).forEach((participantId) => {
      meetingStore.media.updateAudioLevel(
        participantId,
        oldState.participantAudioLevels[participantId]
      );
    });
  }

  if (oldState.hasCameraPermission !== undefined) {
    meetingStore.media.setCameraPermission(oldState.hasCameraPermission);
  }

  if (oldState.webrtcService) {
    meetingStore.webrtc.setWebRTCService(oldState.webrtcService);
  }

  if (oldState.peers) {
    oldState.peers.forEach((peer: PeerConnection) => {
      meetingStore.webrtc.addPeer(peer);
    });
  }

  if (oldState.connectionStatus) {
    meetingStore.webrtc.setConnectionStatus(oldState.connectionStatus);
  }

  if (oldState.showPublicUserModal !== undefined) {
    meetingStore.publicUser.setShowModal(oldState.showPublicUserModal);
  }

  if (oldState.publicSessionId) {
    meetingStore.publicUser.setPublicUser(
      true,
      oldState.publicSessionId,
      oldState.publicUserName || ""
    );
  }

  if (oldState.loading !== undefined) {
    meetingStore.meeting.setLoading(oldState.loading);
  }

  if (oldState.error !== undefined) {
    meetingStore.meeting.setError(oldState.error);
  }

  console.log("[Meeting Compat] State migration completed");
}

/**
 * Create a migration wrapper for existing components
 * This allows existing components to work with minimal changes
 */
export function createMigrationWrapper(meetingId: string) {
  const adapter = createMeetingCompatAdapter(meetingId);

  return {
    // Initialize the wrapper
    async initialize() {
      await adapter.initialize();
    },

    // Get state in old format
    getState() {
      return adapter.getCompatState();
    },

    // Subscribe to state changes
    subscribe(callback: (state: any) => void) {
      return adapter.subscribe(callback);
    },

    // Legacy method bindings
    loadMeeting: () => adapter.loadMeeting(),
    checkPublicUserSession: () => adapter.checkPublicUserSession(),
    handlePublicUserSubmit: (name: string) =>
      adapter.handlePublicUserSubmit(name),
    leaveMeetingAsPublicUser: () => adapter.leaveMeetingAsPublicUser(),
    initializeWebRTC: () => adapter.initializeWebRTC(),
    setupMediaDevices: () => adapter.setupMediaDevices(),
    toggleMic: () => adapter.toggleMic(),
    toggleVideo: () => adapter.toggleVideo(),
    hangUp: () => adapter.hangUp(),
    generateSessionId: () => adapter.generateSessionId(),
    getAudioLevel: (level: number) => adapter.getAudioLevel(level),
    isSpeaking: (level: number) => adapter.isSpeaking(level),
    stopAllMediaTracks: () => adapter.stopAllMediaTracks(),
    cleanupAudio: () => adapter.cleanupAudio(),

    // Cleanup
    destroy: () => adapter.destroy(),
  };
}
