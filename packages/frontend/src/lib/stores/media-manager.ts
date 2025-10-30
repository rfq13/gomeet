import { get } from "svelte/store";
import { meetingStore } from "./meeting.store";
import { logUserAction } from "$lib/errors";
import { getAudioContextPool, type PooledAudioContext } from "$lib/audio";

/**
 * Media Management Utility
 *
 * This utility provides centralized media device management and synchronization
 * with the meeting store. It handles camera/microphone access, stream management,
 * and audio level monitoring.
 */

export interface MediaManagerOptions {
  // Video constraints
  videoConstraints?: MediaTrackConstraints;

  // Audio constraints
  audioConstraints?: MediaTrackConstraints;

  // Audio monitoring
  enableAudioMonitoring?: boolean;
  audioUpdateInterval?: number;

  // Error handling
  autoRetryOnFailure?: boolean;
  maxRetryAttempts?: number;
}

export class MediaManager {
  private meetingStore = meetingStore;
  private audioContextPool = getAudioContextPool();
  private pooledAudioContext: PooledAudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private remoteAnalysers: { [key: string]: AnalyserNode } = {};
  private animationFrameId: number | null = null;
  private retryAttempts = 0;
  private maxRetryAttempts: number;
  private autoRetry: boolean;
  private audioUpdateInterval: number;
  private enableAudioMonitoring: boolean;
  private isDestroyed = false;

  constructor(private options: MediaManagerOptions = {}) {
    this.maxRetryAttempts = options.maxRetryAttempts ?? 3;
    this.autoRetry = options.autoRetryOnFailure ?? true;
    this.audioUpdateInterval = options.audioUpdateInterval ?? 100;
    this.enableAudioMonitoring = options.enableAudioMonitoring ?? true;

    console.log("[Media Manager] Initialized with options:", {
      enableAudioMonitoring: this.enableAudioMonitoring,
      autoRetry: this.autoRetry,
      maxRetryAttempts: this.maxRetryAttempts,
      audioUpdateInterval: this.audioUpdateInterval,
    });
  }

  /**
   * Initialize media devices and set up local stream
   */
  async initialize(): Promise<MediaStream> {
    try {
      console.log("[Media Manager] Initializing media devices...");

      // Get media constraints
      const constraints = this.getMediaConstraints();

      // Request media access
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Store stream in meeting store
      this.meetingStore.media.setLocalStream(stream);
      this.meetingStore.media.setCameraPermission(true);

      // Set up audio monitoring if enabled
      if (this.enableAudioMonitoring) {
        await this.setupAudioMonitoring(stream);
      }

      // Reset retry attempts on success
      this.retryAttempts = 0;

      console.log("[Media Manager] Media devices initialized successfully");
      logUserAction("media_initialized", {
        hasVideo: stream.getVideoTracks().length > 0,
        hasAudio: stream.getAudioTracks().length > 0,
        timestamp: new Date().toISOString(),
      });

      return stream;
    } catch (error) {
      console.error(
        "[Media Manager] Failed to initialize media devices:",
        error
      );

      // Handle permission denied
      if (error instanceof Error && error.name === "NotAllowedError") {
        this.meetingStore.media.setCameraPermission(false);
        this.meetingStore.meeting.setError(
          "Camera and microphone access is required to join the meeting"
        );
      } else {
        this.meetingStore.meeting.setError(
          `Failed to access media devices: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }

      // Attempt retry if enabled
      if (this.autoRetry && this.retryAttempts < this.maxRetryAttempts) {
        await this.attemptRetry();
      }

      logUserAction("media_initialization_failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        attempt: this.retryAttempts + 1,
        timestamp: new Date().toISOString(),
      });

      throw error;
    }
  }

  /**
   * Toggle microphone on/off
   */
  async toggleMicrophone(): Promise<void> {
    try {
      const state = this.meetingStore.getState();

      if (!state.media.localStream) {
        throw new Error("No local stream available");
      }

      const audioTracks = state.media.localStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error("No audio tracks available");
      }

      const isEnabled = audioTracks[0].enabled;
      audioTracks[0].enabled = !isEnabled;

      // Update store
      this.meetingStore.media.toggleMic();

      console.log(
        `[Media Manager] Microphone ${!isEnabled ? "enabled" : "disabled"}`
      );
      logUserAction("microphone_toggled", {
        enabled: !isEnabled,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Media Manager] Failed to toggle microphone:", error);
      this.meetingStore.meeting.setError(
        `Failed to toggle microphone: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Toggle video on/off
   */
  async toggleVideo(): Promise<void> {
    try {
      const state = this.meetingStore.getState();

      if (!state.media.localStream) {
        throw new Error("No local stream available");
      }

      const videoTracks = state.media.localStream.getVideoTracks();
      if (videoTracks.length === 0) {
        throw new Error("No video tracks available");
      }

      const isEnabled = videoTracks[0].enabled;

      if (isEnabled) {
        // Stop video completely
        await this.stopVideo();
      } else {
        // Start video
        await this.startVideo();
      }

      // Update store
      this.meetingStore.media.toggleVideo();

      console.log(
        `[Media Manager] Video ${!isEnabled ? "enabled" : "disabled"}`
      );
      logUserAction("video_toggled", {
        enabled: !isEnabled,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Media Manager] Failed to toggle video:", error);
      this.meetingStore.meeting.setError(
        `Failed to toggle video: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Stop video track completely
   */
  private async stopVideo(): Promise<void> {
    const state = this.meetingStore.getState();

    if (!state.media.localStream) return;

    const videoTracks = state.media.localStream.getVideoTracks();
    videoTracks.forEach((track) => {
      track.stop();
      state.media.localStream?.removeTrack(track);
    });
  }

  /**
   * Start video track
   */
  private async startVideo(): Promise<void> {
    try {
      const state = this.meetingStore.getState();

      if (!state.media.localStream) {
        throw new Error("No local stream available");
      }

      // Get new video track
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: this.options.videoConstraints || { facingMode: "user" },
      });

      const newVideoTrack = newStream.getVideoTracks()[0];

      if (newVideoTrack && state.media.localStream) {
        state.media.localStream.addTrack(newVideoTrack);
      }
    } catch (error) {
      console.error("[Media Manager] Failed to start video:", error);
      throw error;
    }
  }

  /**
   * Update local stream (useful for stream changes)
   */
  async updateLocalStream(newStream: MediaStream): Promise<void> {
    try {
      console.log("[Media Manager] Updating local stream...");

      // Stop old stream tracks
      const oldState = this.meetingStore.getState();
      if (oldState.media.localStream) {
        oldState.media.localStream.getTracks().forEach((track) => track.stop());
      }

      // Store new stream
      this.meetingStore.media.setLocalStream(newStream);

      // Set up audio monitoring for new stream
      if (this.enableAudioMonitoring) {
        await this.setupAudioMonitoring(newStream);
      }

      console.log("[Media Manager] Local stream updated successfully");
      logUserAction("local_stream_updated", {
        hasVideo: newStream.getVideoTracks().length > 0,
        hasAudio: newStream.getAudioTracks().length > 0,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Media Manager] Failed to update local stream:", error);
      this.meetingStore.meeting.setError(
        `Failed to update local stream: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Set up audio level monitoring
   */
  private async setupAudioMonitoring(stream: MediaStream): Promise<void> {
    try {
      if (!this.enableAudioMonitoring) return;

      // Get audio context from pool
      if (!this.pooledAudioContext) {
        this.pooledAudioContext = await this.audioContextPool.acquire({
          sampleRate: 48000,
          latencyHint: "interactive",
        });
      }

      const audioContext = this.pooledAudioContext.context;

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // Create analyser for local audio
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const source = audioContext.createMediaStreamSource(stream);
        this.analyser = audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        source.connect(this.analyser);
      }

      // Start audio level detection
      this.startAudioLevelDetection();

      console.log("[Media Manager] Audio monitoring set up successfully");
    } catch (error) {
      console.error(
        "[Media Manager] Failed to set up audio monitoring:",
        error
      );
    }
  }

  /**
   * Set up audio monitoring for remote stream
   */
  setupRemoteAudioMonitoring(peerId: string, stream: MediaStream): void {
    try {
      if (!this.enableAudioMonitoring || !this.pooledAudioContext) return;

      const audioContext = this.pooledAudioContext.context;
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return;

      const source = audioContext.createMediaStreamSource(stream);
      const remoteAnalyser = audioContext.createAnalyser();
      remoteAnalyser.fftSize = 256;
      source.connect(remoteAnalyser);

      this.remoteAnalysers[peerId] = remoteAnalyser;

      console.log(
        `[Media Manager] Remote audio monitoring set up for peer: ${peerId}`
      );
    } catch (error) {
      console.error(
        `[Media Manager] Failed to set up remote audio monitoring for ${peerId}:`,
        error
      );
    }
  }

  /**
   * Remove remote audio monitoring
   */
  removeRemoteAudioMonitoring(peerId: string): void {
    if (this.remoteAnalysers[peerId]) {
      delete this.remoteAnalysers[peerId];
      console.log(
        `[Media Manager] Remote audio monitoring removed for peer: ${peerId}`
      );
    }
  }

  /**
   * Start audio level detection
   */
  private startAudioLevelDetection(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    const detectLevels = () => {
      if (this.isDestroyed) return;

      // Detect local audio level
      if (this.analyser) {
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        this.meetingStore.media.updateAudioLevel("local", average);
      }

      // Detect remote audio levels
      Object.keys(this.remoteAnalysers).forEach((peerId) => {
        const remoteAnalyser = this.remoteAnalysers[peerId];
        if (remoteAnalyser) {
          const dataArray = new Uint8Array(remoteAnalyser.frequencyBinCount);
          remoteAnalyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          this.meetingStore.media.updateAudioLevel(peerId, average);
        }
      });

      this.animationFrameId = requestAnimationFrame(detectLevels);
    };

    detectLevels();
  }

  /**
   * Get media constraints
   */
  private getMediaConstraints(): MediaStreamConstraints {
    return {
      video: this.options.videoConstraints || {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: this.options.audioConstraints || {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    };
  }

  /**
   * Attempt retry after failure
   */
  private async attemptRetry(): Promise<void> {
    if (this.isDestroyed) return;

    this.retryAttempts++;
    console.log(
      `[Media Manager] Attempting retry (${this.retryAttempts}/${this.maxRetryAttempts})`
    );

    try {
      // Wait before retrying
      await this.delay(Math.pow(2, this.retryAttempts) * 1000); // Exponential backoff

      // Retry initialization
      await this.initialize();

      console.log("[Media Manager] Retry successful");
      logUserAction("media_retry_successful", {
        attempt: this.retryAttempts,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(
        `[Media Manager] Retry attempt ${this.retryAttempts} failed:`,
        error
      );

      if (this.retryAttempts < this.maxRetryAttempts) {
        await this.attemptRetry();
      } else {
        console.error("[Media Manager] Max retry attempts reached");
        this.meetingStore.meeting.setError(
          "Failed to access media devices after multiple attempts"
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
   * Get current media state
   */
  getMediaState() {
    return this.meetingStore.getState().media;
  }

  /**
   * Check if microphone is enabled
   */
  isMicrophoneEnabled(): boolean {
    return this.meetingStore.getState().media.isMicOn;
  }

  /**
   * Check if video is enabled
   */
  isVideoEnabled(): boolean {
    return this.meetingStore.getState().media.isVideoOn;
  }

  /**
   * Get local stream
   */
  getLocalStream(): MediaStream | null {
    return this.meetingStore.getState().media.localStream;
  }

  /**
   * Destroy media manager and clean up resources
   */
  destroy(): void {
    if (this.isDestroyed) return;

    console.log("[Media Manager] Destroying...");
    this.isDestroyed = true;

    // Stop animation frame
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Release audio context back to pool
    if (this.pooledAudioContext) {
      this.audioContextPool.release(this.pooledAudioContext.id);
      this.pooledAudioContext = null;
    }

    // Clear analysers
    this.analyser = null;
    this.remoteAnalysers = {};

    // Stop local stream tracks
    const state = this.meetingStore.getState();
    if (state.media.localStream) {
      state.media.localStream.getTracks().forEach((track) => track.stop());
      this.meetingStore.media.setLocalStream(null);
    }

    logUserAction("media_manager_destroyed", {
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Factory function to create media manager instance
 */
export function createMediaManager(
  options?: MediaManagerOptions
): MediaManager {
  return new MediaManager(options);
}

/**
 * Utility function to create media manager with default constraints
 */
export function createDefaultMediaManager(): MediaManager {
  return createMediaManager({
    videoConstraints: {
      facingMode: "user",
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
    },
    audioConstraints: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
    },
    enableAudioMonitoring: true,
    autoRetryOnFailure: true,
    maxRetryAttempts: 3,
  });
}
