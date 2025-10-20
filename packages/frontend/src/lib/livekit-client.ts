import {
  Room,
  RoomEvent,
  RemoteParticipant,
  LocalParticipant,
  Track,
  Participant,
  ConnectionQuality,
} from "livekit-client";

export interface LiveKitClientConfig {
  serverUrl: string;
  token: string;
}

export interface ParticipantInfo {
  identity: string;
  name: string;
  isSpeaking: boolean;
  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
  tracks: Track[];
}

export interface LiveKitClientEvents {
  roomConnected: () => void;
  roomDisconnected: () => void;
  participantJoined: (participant: RemoteParticipant) => void;
  participantLeft: (participant: RemoteParticipant) => void;
  localTrackPublished: (
    track: Track,
    localParticipant: LocalParticipant
  ) => void;
  localTrackUnpublished: (
    track: Track,
    localParticipant: LocalParticipant
  ) => void;
  remoteTrackPublished: (track: Track, participant: RemoteParticipant) => void;
  remoteTrackUnpublished: (
    track: Track,
    participant: RemoteParticipant
  ) => void;
  activeSpeakersChanged: (speakers: Participant[]) => void;
  connectionQualityChanged: (
    quality: ConnectionQuality,
    participant: Participant
  ) => void;
  error: (error: Error) => void;
}

export class LiveKitClient {
  private room: Room | null = null;
  private config: LiveKitClientConfig | null = null;
  private eventListeners: Map<keyof LiveKitClientEvents, Function[]> =
    new Map();
  private isConnected = false;

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Initialize event listeners map
    const events: (keyof LiveKitClientEvents)[] = [
      "roomConnected",
      "roomDisconnected",
      "participantJoined",
      "participantLeft",
      "localTrackPublished",
      "localTrackUnpublished",
      "remoteTrackPublished",
      "remoteTrackUnpublished",
      "activeSpeakersChanged",
      "connectionQualityChanged",
      "error",
    ];

    events.forEach((event) => {
      this.eventListeners.set(event, []);
    });
  }

  /**
   * Connect to a LiveKit room
   */
  async connect(config: LiveKitClientConfig): Promise<void> {
    try {
      this.config = config;

      // Create new room instance
      this.room = new Room();

      // Setup room event listeners
      this.setupRoomEventListeners();

      // Connect to the room
      await this.room.connect(config.serverUrl, config.token);

      this.isConnected = true;
      this.emit("roomConnected");

      console.log("Connected to LiveKit room:", this.room.name);
    } catch (error) {
      console.error("Failed to connect to LiveKit room:", error);
      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Disconnect from the current room
   */
  async disconnect(): Promise<void> {
    if (!this.room || !this.isConnected) {
      return;
    }

    try {
      await this.room.disconnect();
      this.isConnected = false;
      this.emit("roomDisconnected");
      console.log("Disconnected from LiveKit room");
    } catch (error) {
      console.error("Failed to disconnect from LiveKit room:", error);
      this.emit("error", error as Error);
    }
  }

  /**
   * Enable camera (video)
   */
  async enableCamera(): Promise<void> {
    if (!this.room) {
      throw new Error("Not connected to a room");
    }

    try {
      await this.room.localParticipant.setCameraEnabled(true);
      console.log("Camera enabled");
    } catch (error) {
      console.error("Failed to enable camera:", error);
      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Disable camera (video)
   */
  async disableCamera(): Promise<void> {
    if (!this.room) {
      throw new Error("Not connected to a room");
    }

    try {
      await this.room.localParticipant.setCameraEnabled(false);
      console.log("Camera disabled");
    } catch (error) {
      console.error("Failed to disable camera:", error);
      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Enable microphone (audio)
   */
  async enableMicrophone(): Promise<void> {
    if (!this.room) {
      throw new Error("Not connected to a room");
    }

    try {
      await this.room.localParticipant.setMicrophoneEnabled(true);
      console.log("Microphone enabled");
    } catch (error) {
      console.error("Failed to enable microphone:", error);
      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Disable microphone (audio)
   */
  async disableMicrophone(): Promise<void> {
    if (!this.room) {
      throw new Error("Not connected to a room");
    }

    try {
      await this.room.localParticipant.setMicrophoneEnabled(false);
      console.log("Microphone disabled");
    } catch (error) {
      console.error("Failed to disable microphone:", error);
      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Get local participant
   */
  getLocalParticipant(): LocalParticipant | null {
    return this.room?.localParticipant || null;
  }

  /**
   * Get remote participants
   */
  getRemoteParticipants(): RemoteParticipant[] {
    if (!this.room) {
      return [];
    }

    return Array.from(this.room.remoteParticipants.values());
  }

  /**
   * Get participant by identity
   */
  getParticipantByIdentity(identity: string): RemoteParticipant | null {
    if (!this.room) {
      return null;
    }

    return this.room.remoteParticipants.get(identity) || null;
  }

  /**
   * Get all participants (local + remote)
   */
  getAllParticipants(): Participant[] {
    const participants: Participant[] = [];

    if (this.room?.localParticipant) {
      participants.push(this.room.localParticipant);
    }

    if (this.room) {
      participants.push(...Array.from(this.room.remoteParticipants.values()));
    }

    return participants;
  }

  /**
   * Get participant info for UI
   */
  getParticipantInfo(participant: Participant): ParticipantInfo {
    const tracks = Array.from(participant.trackPublications.values())
      .map((publication) => publication.track)
      .filter((track): track is Track => track !== undefined);

    return {
      identity: participant.identity,
      name: participant.name || participant.identity,
      isSpeaking: participant.isSpeaking,
      isCameraEnabled: participant.isCameraEnabled,
      isMicrophoneEnabled: participant.isMicrophoneEnabled,
      tracks,
    };
  }

  /**
   * Get connection stats
   */
  async getConnectionStats(): Promise<any> {
    if (!this.room) {
      return null;
    }

    try {
      // For now, return basic connection info
      return {
        state: this.room.state,
        connectionQuality: this.room.localParticipant.connectionQuality,
      };
    } catch (error) {
      console.error("Failed to get connection stats:", error);
      return null;
    }
  }

  /**
   * Check if connected to room
   */
  isConnectedToRoom(): boolean {
    return this.isConnected && this.room?.state === "connected";
  }

  /**
   * Get room name
   */
  getRoomName(): string | null {
    return this.room?.name || null;
  }

  /**
   * Setup room event listeners
   */
  private setupRoomEventListeners(): void {
    if (!this.room) {
      return;
    }

    // Room events
    this.room.on(RoomEvent.Connected, () => {
      console.log("Room connected");
      this.emit("roomConnected");
    });

    this.room.on(RoomEvent.Disconnected, () => {
      console.log("Room disconnected");
      this.isConnected = false;
      this.emit("roomDisconnected");
    });

    this.room.on(RoomEvent.Reconnecting, () => {
      console.log("Room reconnecting");
    });

    this.room.on(RoomEvent.Reconnected, () => {
      console.log("Room reconnected");
    });

    // Participant events
    this.room.on(
      RoomEvent.ParticipantConnected,
      (participant: RemoteParticipant) => {
        console.log("Participant joined:", participant.identity);
        this.emit("participantJoined", participant);
      }
    );

    this.room.on(
      RoomEvent.ParticipantDisconnected,
      (participant: RemoteParticipant) => {
        console.log("Participant left:", participant.identity);
        this.emit("participantLeft", participant);
      }
    );

    // Track events
    this.room.on(RoomEvent.TrackPublished, (publication, participant) => {
      console.log(
        "Track published:",
        publication.trackSid,
        "by",
        participant.identity
      );
      if (publication.track) {
        this.emit(
          participant.identity === this.room!.localParticipant.identity
            ? "localTrackPublished"
            : "remoteTrackPublished",
          publication.track,
          participant
        );
      }
    });

    this.room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
      console.log(
        "Track unpublished:",
        publication.trackSid,
        "by",
        participant.identity
      );
      if (publication.track) {
        this.emit(
          participant.identity === this.room!.localParticipant.identity
            ? "localTrackUnpublished"
            : "remoteTrackUnpublished",
          publication.track,
          participant
        );
      }
    });

    this.room.on(
      RoomEvent.TrackSubscribed,
      (track, publication, participant) => {
        console.log(
          "Track subscribed:",
          track.sid,
          "from",
          participant.identity
        );
        this.emit("remoteTrackPublished", track, participant);
      }
    );

    this.room.on(
      RoomEvent.TrackUnsubscribed,
      (track, publication, participant) => {
        console.log(
          "Track unsubscribed:",
          track.sid,
          "from",
          participant.identity
        );
        this.emit("remoteTrackUnpublished", track, participant);
      }
    );

    // Active speakers
    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      console.log(
        "Active speakers changed:",
        speakers.map((s) => s.identity)
      );
      this.emit("activeSpeakersChanged", speakers);
    });

    // Connection quality
    this.room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      console.log(
        "Connection quality changed for",
        participant.identity,
        ":",
        quality
      );
      this.emit("connectionQualityChanged", quality, participant);
    });

    // Room metadata
    this.room.on(RoomEvent.RoomMetadataChanged, (metadata) => {
      console.log("Room metadata changed:", metadata);
    });
  }

  /**
   * Add event listener
   */
  on<K extends keyof LiveKitClientEvents>(
    event: K,
    listener: LiveKitClientEvents[K]
  ): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.push(listener as Function);
    this.eventListeners.set(event, listeners);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof LiveKitClientEvents>(
    event: K,
    listener: LiveKitClientEvents[K]
  ): void {
    const listeners = this.eventListeners.get(event) || [];
    const index = listeners.indexOf(listener as Function);
    if (index > -1) {
      listeners.splice(index, 1);
      this.eventListeners.set(event, listeners);
    }
  }

  /**
   * Emit event to all listeners
   */
  private emit<K extends keyof LiveKitClientEvents>(
    event: K,
    ...args: any[]
  ): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach((listener) => {
      try {
        listener(...args);
      } catch (error) {
        console.error("Error in event listener:", error);
      }
    });
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.disconnect();
    this.eventListeners.clear();
    this.room = null;
    this.config = null;
  }
}

// Create singleton instance
export const liveKitClient = new LiveKitClient();

// Export types for external use
export type {
  Room,
  RemoteParticipant,
  LocalParticipant,
  Track,
  Participant,
  ConnectionQuality,
};
