import { get } from "svelte/store";
import { meetingStore } from "./meeting.store";
import { createWebRTCService, type PeerConnection } from "$lib/webrtc-service";
import type { WebRTCServiceOptions } from "$lib/webrtc-service";
import { logUserAction } from "$lib/errors";

/**
 * WebRTC Synchronization Layer
 *
 * This layer provides synchronization between the meeting store and WebRTC service.
 * It handles WebRTC lifecycle management and ensures state consistency.
 */

export interface WebRTCSyncOptions
  extends Omit<
    WebRTCServiceOptions,
    | "onPeerJoined"
    | "onPeerLeft"
    | "onRemoteStream"
    | "onPeerStateChange"
    | "onError"
  > {
  // Additional options for sync layer
  autoConnect?: boolean;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
}

export class WebRTCSync {
  private meetingStore = meetingStore;
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private autoReconnect: boolean;
  private isDestroyed = false;

  constructor(private options: WebRTCSyncOptions) {
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 3;

    console.log("[WebRTC Sync] Initialized with options:", {
      meetingId: options.meetingId,
      autoConnect: options.autoConnect,
      autoReconnect: this.autoReconnect,
      maxReconnectAttempts: this.maxReconnectAttempts,
    });

    // Auto-connect if enabled
    if (options.autoConnect) {
      this.initialize();
    }
  }

  /**
   * Initialize WebRTC service and set up event handlers
   */
  async initialize(): Promise<void> {
    try {
      console.log("[WebRTC Sync] Starting initialization...");

      const state = this.meetingStore.getState();

      if (!state.media.localStream) {
        throw new Error(
          "Local stream not available. Ensure media devices are set up first."
        );
      }

      // Create WebRTC service with synchronized event handlers
      const webrtcService = createWebRTCService({
        ...this.options,
        localStream: state.media.localStream,
        onPeerJoined: this.handlePeerJoined.bind(this),
        onPeerLeft: this.handlePeerLeft.bind(this),
        onRemoteStream: this.handleRemoteStream.bind(this),
        onPeerStateChange: this.handlePeerStateChange.bind(this),
        onError: this.handleWebRTCError.bind(this),
      });

      // Store service in meeting store
      this.meetingStore.webrtc.setWebRTCService(webrtcService);

      // Connect to WebRTC
      await this.connect();

      console.log("[WebRTC Sync] Initialization completed successfully");
      logUserAction("webrtc_sync_initialized", {
        meetingId: this.options.meetingId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[WebRTC Sync] Initialization failed:", error);
      this.handleWebRTCError(error as Error);
      throw error;
    }
  }

  /**
   * Connect to WebRTC service
   */
  async connect(): Promise<void> {
    try {
      console.log("[WebRTC Sync] Connecting to WebRTC...");

      const state = this.meetingStore.getState();

      if (!state.webrtc.service) {
        throw new Error("WebRTC service not initialized");
      }

      // Set connection status to connecting
      this.meetingStore.webrtc.setConnectionStatus("connecting");

      // Connect to WebRTC
      await state.webrtc.service.connect();

      // Set connection status to connected
      this.meetingStore.webrtc.setConnectionStatus("connected");

      // Reset reconnect attempts on successful connection
      this.reconnectAttempts = 0;

      console.log("[WebRTC Sync] Connected successfully");
      logUserAction("webrtc_connected", {
        meetingId: this.options.meetingId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[WebRTC Sync] Connection failed:", error);
      this.meetingStore.webrtc.setConnectionStatus("disconnected");

      // Attempt reconnection if enabled
      if (
        this.autoReconnect &&
        this.reconnectAttempts < this.maxReconnectAttempts
      ) {
        await this.attemptReconnect();
      } else {
        this.handleWebRTCError(error as Error);
      }

      throw error;
    }
  }

  /**
   * Disconnect from WebRTC service
   */
  async disconnect(): Promise<void> {
    try {
      console.log("[WebRTC Sync] Disconnecting from WebRTC...");

      const state = this.meetingStore.getState();

      if (state.webrtc.service) {
        state.webrtc.service.destroy();
        this.meetingStore.webrtc.setWebRTCService(null);
      }

      // Reset WebRTC state
      this.meetingStore.webrtc.resetWebRTC();

      console.log("[WebRTC Sync] Disconnected successfully");
      logUserAction("webrtc_disconnected", {
        meetingId: this.options.meetingId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[WebRTC Sync] Disconnect failed:", error);
      this.handleWebRTCError(error as Error);
    }
  }

  /**
   * Update local stream in WebRTC service
   */
  async updateLocalStream(newStream: MediaStream): Promise<void> {
    try {
      console.log("[WebRTC Sync] Updating local stream...");

      const state = this.meetingStore.getState();

      if (state.webrtc.service) {
        state.webrtc.service.updateLocalStream(newStream);
      }

      // Update stream in meeting store
      this.meetingStore.media.setLocalStream(newStream);

      console.log("[WebRTC Sync] Local stream updated successfully");
    } catch (error) {
      console.error("[WebRTC Sync] Failed to update local stream:", error);
      this.handleWebRTCError(error as Error);
    }
  }

  /**
   * Toggle microphone
   */
  toggleMicrophone(): void {
    const state = this.meetingStore.getState();

    if (state.webrtc.service) {
      const isMuted = !state.media.isMicOn;
      state.webrtc.service.muteAudio(isMuted);
    }

    this.meetingStore.media.toggleMic();
  }

  /**
   * Toggle video
   */
  toggleVideo(): void {
    const state = this.meetingStore.getState();

    if (state.webrtc.service) {
      const isMuted = !state.media.isVideoOn;
      state.webrtc.service.muteVideo(isMuted);
    }

    this.meetingStore.media.toggleVideo();
  }

  /**
   * Handle peer joined event
   */
  private handlePeerJoined(peer: PeerConnection): void {
    console.log("[WebRTC Sync] Peer joined:", peer);

    // Add peer to meeting store
    this.meetingStore.webrtc.addPeer(peer);

    logUserAction("peer_joined", {
      meetingId: this.options.meetingId,
      peerId: peer.id,
      peerName: peer.name,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle peer left event
   */
  private handlePeerLeft(peerId: string): void {
    console.log("[WebRTC Sync] Peer left:", peerId);

    // Remove peer from meeting store
    this.meetingStore.webrtc.removePeer(peerId);

    // Remove remote stream if exists
    this.meetingStore.media.removeRemoteStream(peerId);

    logUserAction("peer_left", {
      meetingId: this.options.meetingId,
      peerId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle remote stream event
   */
  private handleRemoteStream(peerId: string, stream: MediaStream): void {
    console.log("[WebRTC Sync] Received remote stream:", peerId);

    // Add remote stream to meeting store
    this.meetingStore.media.addRemoteStream(peerId, stream);

    logUserAction("remote_stream_received", {
      meetingId: this.options.meetingId,
      peerId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle peer state change event
   */
  private handlePeerStateChange(
    peerId: string,
    state: RTCPeerConnectionState
  ): void {
    console.log("[WebRTC Sync] Peer state changed:", peerId, state);

    // Update peer state in meeting store
    this.meetingStore.webrtc.updatePeer(peerId, {
      connection: { connectionState: state } as any,
    });

    logUserAction("peer_state_changed", {
      meetingId: this.options.meetingId,
      peerId,
      state,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle WebRTC errors
   */
  private handleWebRTCError(error: Error): void {
    console.error("[WebRTC Sync] WebRTC error:", error);

    // Add error to meeting store
    this.meetingStore.meeting.setError(error.message);

    logUserAction("webrtc_error", {
      meetingId: this.options.meetingId,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Attempt to reconnect WebRTC connection
   */
  private async attemptReconnect(): Promise<void> {
    if (this.isDestroyed) return;

    this.reconnectAttempts++;
    console.log(
      `[WebRTC Sync] Attempting reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    try {
      // Wait before attempting reconnection
      await this.delay(Math.pow(2, this.reconnectAttempts) * 1000); // Exponential backoff

      // Disconnect first
      await this.disconnect();

      // Wait a bit before reconnecting
      await this.delay(1000);

      // Reinitialize
      await this.initialize();

      console.log("[WebRTC Sync] Reconnection successful");
      logUserAction("webrtc_reconnected", {
        meetingId: this.options.meetingId,
        attempt: this.reconnectAttempts,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(
        `[WebRTC Sync] Reconnection attempt ${this.reconnectAttempts} failed:`,
        error
      );

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        // Try again
        await this.attemptReconnect();
      } else {
        console.error("[WebRTC Sync] Max reconnection attempts reached");
        this.handleWebRTCError(
          new Error("Failed to reconnect after maximum attempts")
        );
      }
    }
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current connection status
   */
  getConnectionStatus(): string {
    return this.meetingStore.getState().webrtc.connectionStatus;
  }

  /**
   * Get current peers
   */
  getPeers(): PeerConnection[] {
    return this.meetingStore.getState().webrtc.peers;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.meetingStore.getState().webrtc.connectionStatus === "connected";
  }

  /**
   * Destroy sync instance and clean up resources
   */
  destroy(): void {
    if (this.isDestroyed) return;

    console.log("[WebRTC Sync] Destroying...");
    this.isDestroyed = true;

    // Disconnect and cleanup
    this.disconnect().catch((error) => {
      console.error("[WebRTC Sync] Error during destroy:", error);
    });

    logUserAction("webrtc_sync_destroyed", {
      meetingId: this.options.meetingId,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Factory function to create WebRTC sync instance
 */
export function createWebRTCSync(options: WebRTCSyncOptions): WebRTCSync {
  return new WebRTCSync(options);
}

/**
 * Utility function to create WebRTC sync from meeting store state
 */
export function createWebRTCSyncFromStore(): WebRTCSync | null {
  const state = meetingStore.getState();

  if (!state.meetingId || !state.media.localStream) {
    console.warn(
      "[WebRTC Sync] Cannot create sync: missing meeting ID or local stream"
    );
    return null;
  }

  const user = state.user;
  const publicUser = state.publicUser;

  return createWebRTCSync({
    meetingId: state.meetingId,
    localStream: state.media.localStream,
    token: user ? localStorage.getItem("accessToken") || undefined : undefined,
    sessionId: publicUser.isPublicUser
      ? publicUser.sessionId || undefined
      : undefined,
    autoConnect: false, // Let the caller decide when to connect
    autoReconnect: true,
    maxReconnectAttempts: 3,
  });
}
