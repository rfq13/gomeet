import { get } from "svelte/store";
import { meetingStore } from "./meeting.store";
import { createWebRTCSync, type WebRTCSync } from "./webrtc-sync";
import { createDefaultMediaManager, type MediaManager } from "./media-manager";
import { meetingService } from "$lib/meeting-service";
import { apiClient } from "$lib/api-client";
import { authStore } from "./auth.store";
import { logUserAction } from "$lib/errors";
import type { Meeting, User, PublicUser } from "$types";

/**
 * Integrated Meeting Manager
 *
 * This is the main orchestrator that combines meeting store, WebRTC sync,
 * and media manager into a unified interface. It provides high-level methods
 * for meeting lifecycle management.
 */

export interface MeetingManagerOptions {
  // Meeting configuration
  meetingId: string;

  // Media configuration
  enableAudio?: boolean;
  enableVideo?: boolean;

  // WebRTC configuration
  autoConnectWebRTC?: boolean;
  autoReconnectWebRTC?: boolean;

  // Public user configuration
  isPublicUser?: boolean;
  publicSessionId?: string;
}

export class MeetingManager {
  private meetingStore = meetingStore;
  private webRTCSync: WebRTCSync | null = null;
  private mediaManager: MediaManager | null = null;
  private isDestroyed = false;
  private isInitialized = false;

  constructor(private options: MeetingManagerOptions) {
    console.log("[Meeting Manager] Initialized with options:", {
      meetingId: options.meetingId,
      enableAudio: options.enableAudio,
      enableVideo: options.enableVideo,
      isPublicUser: options.isPublicUser,
    });

    // Initialize meeting store
    this.meetingStore.initialize();
  }

  /**
   * Initialize the meeting manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn("[Meeting Manager] Already initialized");
      return;
    }

    try {
      console.log("[Meeting Manager] Starting initialization...");

      // Set loading state
      this.meetingStore.meeting.setLoading(true);

      // Step 1: Load meeting data
      await this.loadMeetingData();

      // Step 2: Set up user context
      await this.setupUserContext();

      // Step 3: Initialize media manager
      await this.initializeMediaManager();

      // Step 4: Initialize WebRTC if auto-connect is enabled
      if (this.options.autoConnectWebRTC) {
        await this.initializeWebRTC();
      }

      this.isInitialized = true;
      this.meetingStore.meeting.setLoading(false);

      console.log("[Meeting Manager] Initialization completed successfully");
      logUserAction("meeting_manager_initialized", {
        meetingId: this.options.meetingId,
        isPublicUser: this.options.isPublicUser,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Meeting Manager] Initialization failed:", error);
      this.meetingStore.meeting.setError(
        error instanceof Error ? error.message : "Initialization failed"
      );
      this.meetingStore.meeting.setLoading(false);
      throw error;
    }
  }

  /**
   * Load meeting data from API
   */
  private async loadMeetingData(): Promise<void> {
    try {
      console.log("[Meeting Manager] Loading meeting data...");

      const state = this.meetingStore.getState();
      const isPublicUser =
        state.publicUser.isPublicUser || this.options.isPublicUser;

      // Load meeting data (public or authenticated)
      const meeting = isPublicUser
        ? await meetingService.getMeetingPublic(this.options.meetingId)
        : await meetingService.getMeeting(this.options.meetingId);

      // Store meeting data
      this.meetingStore.meeting.setMeeting(meeting);

      console.log("[Meeting Manager] Meeting data loaded successfully");
    } catch (error) {
      console.error("[Meeting Manager] Failed to load meeting data:", error);
      throw new Error(
        `Failed to load meeting: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Set up user context (authenticated or public user)
   */
  private async setupUserContext(): Promise<void> {
    try {
      console.log("[Meeting Manager] Setting up user context...");

      const state = this.meetingStore.getState();

      if (this.options.isPublicUser) {
        // Set up public user context
        if (this.options.publicSessionId) {
          this.meetingStore.publicUser.setPublicUser(
            true,
            this.options.publicSessionId,
            state.publicUser.userName
          );

          // Try to get existing public user data
          await this.loadPublicUserData(this.options.publicSessionId);
        }
      } else {
        // Set up authenticated user context
        const authState = get(authStore);
        if (authState.user) {
          this.meetingStore.user.setUser(authState.user);
        } else {
          throw new Error("No authenticated user found");
        }
      }

      console.log("[Meeting Manager] User context set up successfully");
    } catch (error) {
      console.error("[Meeting Manager] Failed to set up user context:", error);
      throw error;
    }
  }

  /**
   * Load public user data
   */
  private async loadPublicUserData(sessionId: string): Promise<void> {
    try {
      const publicUser = await apiClient.getPublicUserBySessionId(sessionId);
      if (publicUser) {
        this.meetingStore.publicUser.setUserName(publicUser.name);
      }
    } catch (error) {
      console.warn("[Meeting Manager] Could not load public user data:", error);
      // Don't throw error, user can set name manually
    }
  }

  /**
   * Initialize media manager
   */
  private async initializeMediaManager(): Promise<void> {
    try {
      console.log("[Meeting Manager] Initializing media manager...");

      this.mediaManager = createDefaultMediaManager();

      // Initialize media devices
      const stream = await this.mediaManager.initialize();

      console.log("[Meeting Manager] Media manager initialized successfully");
    } catch (error) {
      console.error(
        "[Meeting Manager] Failed to initialize media manager:",
        error
      );
      throw error;
    }
  }

  /**
   * Initialize WebRTC sync
   */
  async initializeWebRTC(): Promise<void> {
    try {
      console.log("[Meeting Manager] Initializing WebRTC...");

      const state = this.meetingStore.getState();

      if (!state.media.localStream) {
        throw new Error(
          "Local stream not available. Please ensure media devices are initialized first."
        );
      }

      // Create WebRTC sync
      this.webRTCSync = createWebRTCSync({
        meetingId: this.options.meetingId,
        localStream: state.media.localStream,
        token: !this.options.isPublicUser
          ? localStorage.getItem("accessToken") || undefined
          : undefined,
        sessionId: this.options.isPublicUser
          ? state.publicUser.sessionId || undefined
          : undefined,
        autoConnect: true,
        autoReconnect: this.options.autoReconnectWebRTC ?? true,
        maxReconnectAttempts: 3,
      });

      console.log("[Meeting Manager] WebRTC initialized successfully");
      logUserAction("webrtc_initialized", {
        meetingId: this.options.meetingId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Meeting Manager] Failed to initialize WebRTC:", error);
      throw error;
    }
  }

  /**
   * Join meeting as public user
   */
  async joinAsPublicUser(userName: string): Promise<void> {
    try {
      console.log("[Meeting Manager] Joining as public user...");

      // Create or get session ID
      let sessionId = this.options.publicSessionId;
      if (!sessionId) {
        sessionId = this.generateSessionId();
      }

      // Create public user
      await apiClient.createPublicUser(userName, sessionId);

      // Update state
      this.meetingStore.publicUser.setPublicUser(true, sessionId, userName);
      this.meetingStore.publicUser.setShowModal(false);

      // Join meeting
      await apiClient.joinMeetingAsPublicUser(
        sessionId,
        this.options.meetingId
      );

      // Initialize WebRTC if not already done
      if (!this.webRTCSync && this.options.autoConnectWebRTC) {
        await this.initializeWebRTC();
      }

      console.log("[Meeting Manager] Joined as public user successfully");
      logUserAction("joined_as_public_user", {
        meetingId: this.options.meetingId,
        sessionId,
        userName,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Meeting Manager] Failed to join as public user:", error);
      throw error;
    }
  }

  /**
   * Leave meeting
   */
  async leaveMeeting(): Promise<void> {
    try {
      console.log("[Meeting Manager] Leaving meeting...");

      const state = this.meetingStore.getState();

      // Leave as public user if applicable
      if (state.publicUser.isPublicUser && state.publicUser.sessionId) {
        await apiClient.leaveMeetingAsPublicUser(
          state.publicUser.sessionId,
          this.options.meetingId
        );
      }

      // Disconnect WebRTC
      if (this.webRTCSync) {
        await this.webRTCSync.disconnect();
        this.webRTCSync = null;
      }

      // Destroy media manager
      if (this.mediaManager) {
        this.mediaManager.destroy();
        this.mediaManager = null;
      }

      // Reset meeting store
      this.meetingStore.reset();

      this.isInitialized = false;

      console.log("[Meeting Manager] Left meeting successfully");
      logUserAction("left_meeting", {
        meetingId: this.options.meetingId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Meeting Manager] Failed to leave meeting:", error);
      throw error;
    }
  }

  /**
   * Toggle microphone
   */
  async toggleMicrophone(): Promise<void> {
    if (this.mediaManager) {
      await this.mediaManager.toggleMicrophone();
    }

    if (this.webRTCSync) {
      this.webRTCSync.toggleMicrophone();
    }
  }

  /**
   * Toggle video
   */
  async toggleVideo(): Promise<void> {
    if (this.mediaManager) {
      await this.mediaManager.toggleVideo();
    }

    if (this.webRTCSync) {
      this.webRTCSync.toggleVideo();
    }
  }

  /**
   * Show public user modal
   */
  showPublicUserModal(): void {
    this.meetingStore.publicUser.setShowModal(true);
  }

  /**
   * Hide public user modal
   */
  hidePublicUserModal(): void {
    this.meetingStore.publicUser.setShowModal(false);
  }

  /**
   * Generate session ID for public users
   */
  private generateSessionId(): string {
    return "pub_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now();
  }

  /**
   * Get current meeting state
   */
  getMeetingState() {
    return this.meetingStore.getState();
  }

  /**
   * Check if meeting is active
   */
  isMeetingActive(): boolean {
    return get(this.meetingStore.isMeetingActive);
  }

  /**
   * Get participant count
   */
  getParticipantCount(): number {
    return get(this.meetingStore.participantCount);
  }

  /**
   * Get all participants
   */
  getAllParticipants() {
    return get(this.meetingStore.allParticipants);
  }

  /**
   * Check if can join meeting
   */
  canJoinMeeting(): boolean {
    return get(this.meetingStore.canJoinMeeting);
  }

  /**
   * Get connection quality
   */
  getConnectionQuality(): string {
    return get(this.meetingStore.connectionQuality);
  }

  /**
   * Check if initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Check if WebRTC is connected
   */
  isWebRTCConnected(): boolean {
    return this.webRTCSync?.isConnected() ?? false;
  }

  /**
   * Handle page visibility change
   */
  handleVisibilityChange(): void {
    if (document.hidden) {
      console.log("[Meeting Manager] Page hidden, pausing operations");
      // Could pause video, lower quality, etc.
    } else {
      console.log("[Meeting Manager] Page visible, resuming operations");
      // Could resume video, restore quality, etc.
    }
  }

  /**
   * Handle beforeunload
   */
  handleBeforeUnload(): void {
    console.log("[Meeting Manager] Page unloading, cleaning up...");
    this.destroy();
  }

  /**
   * Destroy meeting manager and clean up all resources
   */
  destroy(): void {
    if (this.isDestroyed) return;

    console.log("[Meeting Manager] Destroying...");
    this.isDestroyed = true;

    // Leave meeting
    this.leaveMeeting().catch((error) => {
      console.error("[Meeting Manager] Error during destroy:", error);
    });

    logUserAction("meeting_manager_destroyed", {
      meetingId: this.options.meetingId,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Factory function to create meeting manager instance
 */
export function createMeetingManager(
  options: MeetingManagerOptions
): MeetingManager {
  return new MeetingManager(options);
}

/**
 * Utility function to create meeting manager with default options
 */
export function createDefaultMeetingManager(
  meetingId: string,
  isPublicUser = false
): MeetingManager {
  return createMeetingManager({
    meetingId,
    enableAudio: true,
    enableVideo: true,
    autoConnectWebRTC: true,
    autoReconnectWebRTC: true,
    isPublicUser,
  });
}
