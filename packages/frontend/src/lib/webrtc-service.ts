// WebRTC Service untuk handling peer-to-peer connections
import {
  createWebSocketClient,
  type WebSocketClient,
} from "./websocket-client";
import type { SignalingMessage, JoinPayload, LeavePayload } from "$types";
import { getAudioContextPool, type PooledAudioContext } from "$lib/audio";
import { apiClient } from "./api-client";

export interface PeerConnection {
  id: string;
  name: string;
  isAuthenticated: boolean;
  connection: RTCPeerConnection;
  stream?: MediaStream;
  isEmergency?: boolean; // Track if this is an emergency connection
  lastOffer?: RTCSessionDescriptionInit; // Track last offer for state validation
  createdAt: number; // Track when connection was created for debugging
  lastActivity: number; // Track last activity for debugging
}

export interface WebRTCServiceOptions {
  meetingId: string;
  localStream: MediaStream;
  token?: string;
  sessionId?: string;
  onPeerJoined?: (peer: PeerConnection) => void;
  onPeerLeft?: (peerId: string) => void;
  onRemoteStream?: (peerId: string, stream: MediaStream) => void;
  onPeerStateChange?: (peerId: string, state: RTCPeerConnectionState) => void;
  onError?: (error: Error) => void;
  onConnectionQualityChange?: (
    peerId: string,
    quality: "excellent" | "good" | "fair" | "poor"
  ) => void;
}

// Enhanced ICE server configuration from backend
interface ICEServerResponse {
  urls: string[];
  username?: string;
  credential?: string;
  credentialType?: string;
}

interface ICEConfigurationResponse {
  iceServers: ICEServerResponse[];
  configuration: {
    iceCandidatePoolSize: number;
    iceTransportPolicy: string;
    bundlePolicy: string;
    rtcpMuxPolicy: string;
  };
  turnConfig: {
    enabled: boolean;
    server: string;
    port: number;
    maxBandwidth: number;
    totalBandwidth: number;
  };
}

// Connection quality monitoring
interface ConnectionMetrics {
  rtt: number;
  packetsLost: number;
  jitter: number;
  bandwidth: number;
  timestamp: number;
}

export class WebRTCService {
  private options: WebRTCServiceOptions;
  private wsClient: WebSocketClient;
  private peers: Map<string, PeerConnection> = new Map();
  private localPeerId: string | null = null;
  private isDestroyed = false;

  // ICE servers configuration
  private iceServers: RTCIceServer[] = [];
  private iceConfiguration: RTCConfiguration = {};

  // Audio Context Pool
  private audioContextPool = getAudioContextPool();
  private audioContexts: Map<string, PooledAudioContext> = new Map();

  // Connection quality monitoring
  private connectionMetrics: Map<string, ConnectionMetrics[]> = new Map();
  private qualityMonitoringInterval: NodeJS.Timeout | null = null;

  // Cleanup tracking
  private activeTimeouts: Set<NodeJS.Timeout> = new Set();
  private cleanupLog: string[] = [];
  private isCleanupInProgress = false;

  constructor(options: WebRTCServiceOptions) {
    this.options = options;

    // Initialize ICE servers with TURN server support
    this.initializeIceServers();

    console.log(
      "[WebRTC] WebRTCService constructor - sessionId:",
      options.sessionId,
      "token present:",
      !!options.token
    );

    // Create WebSocket client
    this.wsClient = createWebSocketClient({
      meetingId: options.meetingId,
      token: options.token,
      sessionId: options.sessionId,
      onMessage: this.handleSignalingMessage.bind(this),
      onParticipantJoined: this.handleParticipantJoined.bind(this),
      onParticipantLeft: this.handleParticipantLeft.bind(this),
      onConnect: this.handleWebSocketConnect.bind(this),
      onDisconnect: this.handleWebSocketDisconnect.bind(this),
      onError: this.handleWebSocketError.bind(this),
    });
  }

  // Initialize ICE servers with TURN server support from backend
  private async initializeIceServers(): Promise<void> {
    try {
      console.log("[WebRTC] Fetching ICE server configuration from backend");

      // Try to get ICE servers from backend first
      const response = await apiClient.request<{
        success: boolean;
        data: ICEConfigurationResponse;
      }>("/turn/ice-servers", {
        method: "GET",
      });

      if (response.success && response.data) {
        const config = response.data;

        // Convert backend ICE servers to RTCIceServer format
        this.iceServers = config.iceServers.map(
          (server: ICEServerResponse) => ({
            urls: server.urls,
            username: server.username,
            credential: server.credential,
            credentialType: (server.credentialType as any) || "password",
          })
        );

        // Set enhanced ICE configuration
        this.iceConfiguration = {
          iceServers: this.iceServers,
          iceCandidatePoolSize: config.configuration.iceCandidatePoolSize,
          iceTransportPolicy:
            (config.configuration
              .iceTransportPolicy as RTCIceTransportPolicy) || "all",
          bundlePolicy:
            (config.configuration.bundlePolicy as RTCBundlePolicy) ||
            "max-bundle",
          rtcpMuxPolicy:
            (config.configuration.rtcpMuxPolicy as RTCRtcpMuxPolicy) ||
            "require",
        };

        console.log("[WebRTC] ICE configuration loaded from backend:", {
          serverCount: this.iceServers.length,
          hasTurnServers: this.iceServers.some((server) =>
            Array.isArray(server.urls)
              ? server.urls.some((url: string) => url.startsWith("turn"))
              : (server.urls as string).startsWith("turn")
          ),
          turnConfig: config.turnConfig,
        });
      } else {
        throw new Error("Failed to get ICE configuration from backend");
      }
    } catch (error) {
      console.warn(
        "[WebRTC] Failed to load ICE configuration from backend, using fallback:",
        error
      );
      this.initializeFallbackIceServers();
    }
  }

  /**
   * Start connection quality monitoring
   */
  private startQualityMonitoring(): void {
    if (this.qualityMonitoringInterval) {
      clearInterval(this.qualityMonitoringInterval);
    }

    this.qualityMonitoringInterval = setInterval(() => {
      this.monitorConnectionQuality();
    }, 5000); // Monitor every 5 seconds
  }

  /**
   * Monitor connection quality for all peers
   */
  private async monitorConnectionQuality(): Promise<void> {
    for (const [peerId, peer] of this.peers) {
      try {
        const stats = await peer.connection.getStats();
        const metrics = this.extractConnectionMetrics(stats);

        // Store metrics for trend analysis
        if (!this.connectionMetrics.has(peerId)) {
          this.connectionMetrics.set(peerId, []);
        }

        const peerMetrics = this.connectionMetrics.get(peerId)!;
        peerMetrics.push(metrics);

        // Keep only last 10 metrics
        if (peerMetrics.length > 10) {
          peerMetrics.shift();
        }

        // Calculate quality and notify
        const quality = this.calculateConnectionQuality(peerMetrics);
        this.options.onConnectionQualityChange?.(peerId, quality);
      } catch (error) {
        console.error(
          `[WebRTC] Error monitoring quality for peer ${peerId}:`,
          error
        );
      }
    }
  }

  /**
   * Extract connection metrics from WebRTC stats
   */
  private extractConnectionMetrics(stats: RTCStatsReport): ConnectionMetrics {
    let rtt = 0;
    let packetsLost = 0;
    let jitter = 0;
    let bandwidth = 0;

    stats.forEach((report) => {
      if (report.type === "remote-inbound-rtp" && report.kind === "video") {
        rtt = (report as any).roundTripTime || 0;
        packetsLost = (report as any).packetsLost || 0;
        jitter = (report as any).jitter || 0;
      }

      if (report.type === "outbound-rtp" && report.kind === "video") {
        bandwidth = (report as any).bitrate || 0;
      }
    });

    return {
      rtt: rtt * 1000, // Convert to milliseconds
      packetsLost,
      jitter: jitter * 1000, // Convert to milliseconds
      bandwidth,
      timestamp: Date.now(),
    };
  }

  /**
   * Calculate connection quality based on metrics
   */
  private calculateConnectionQuality(
    metrics: ConnectionMetrics[]
  ): "excellent" | "good" | "fair" | "poor" {
    if (metrics.length === 0) return "fair";

    // Calculate averages
    const avgRtt = metrics.reduce((sum, m) => sum + m.rtt, 0) / metrics.length;
    const avgPacketLoss =
      metrics.reduce((sum, m) => sum + m.packetsLost, 0) / metrics.length;
    const avgJitter =
      metrics.reduce((sum, m) => sum + m.jitter, 0) / metrics.length;
    const avgBandwidth =
      metrics.reduce((sum, m) => sum + m.bandwidth, 0) / metrics.length;

    // Quality thresholds
    if (
      avgRtt < 50 &&
      avgPacketLoss < 1 &&
      avgJitter < 10 &&
      avgBandwidth > 1000000
    ) {
      return "excellent";
    } else if (
      avgRtt < 100 &&
      avgPacketLoss < 2 &&
      avgJitter < 30 &&
      avgBandwidth > 500000
    ) {
      return "good";
    } else if (
      avgRtt < 200 &&
      avgPacketLoss < 5 &&
      avgJitter < 50 &&
      avgBandwidth > 200000
    ) {
      return "fair";
    } else {
      return "poor";
    }
  }

  /**
   * Get WebRTC statistics for monitoring
   */
  async getWebRTCStats(): Promise<any> {
    const stats: any = {
      peerCount: this.peers.size,
      peers: {},
      iceServers: this.iceServers.length,
      hasTurnServers: this.iceServers.some((server) =>
        Array.isArray(server.urls)
          ? server.urls.some((url: string) => url.startsWith("turn"))
          : (server.urls as string).startsWith("turn")
      ),
      timestamp: new Date().toISOString(),
    };

    for (const [peerId, peer] of this.peers) {
      try {
        const rtcStats = await peer.connection.getStats();
        const metrics = this.extractConnectionMetrics(rtcStats);
        const quality = this.calculateConnectionQuality(
          this.connectionMetrics.get(peerId) || [metrics]
        );

        stats.peers[peerId] = {
          name: peer.name,
          isAuthenticated: peer.isAuthenticated,
          connectionState: peer.connection.connectionState,
          iceConnectionState: peer.connection.iceConnectionState,
          signalingState: peer.connection.signalingState,
          quality,
          metrics,
          isEmergency: peer.isEmergency || false,
          createdAt: peer.createdAt,
          lastActivity: peer.lastActivity,
        };
      } catch (error) {
        stats.peers[peerId] = {
          name: peer.name,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    return stats;
  }

  /**
   * Optimize connection based on quality
   */
  optimizeConnection(
    peerId: string,
    quality: "excellent" | "good" | "fair" | "poor"
  ): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    console.log(
      `[WebRTC] Optimizing connection for ${peerId} with quality: ${quality}`
    );

    // Apply adaptive strategies based on quality
    switch (quality) {
      case "excellent":
        // Max quality settings
        this.setVideoQuality(peerId, "high");
        break;
      case "good":
        // Balanced settings
        this.setVideoQuality(peerId, "medium");
        break;
      case "fair":
        // Reduced quality
        this.setVideoQuality(peerId, "medium");
        break;
      case "poor":
        // Minimal quality
        this.setVideoQuality(peerId, "low");
        break;
    }
  }

  /**
   * Set video quality for a peer
   */
  private setVideoQuality(
    peerId: string,
    quality: "high" | "medium" | "low"
  ): void {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.stream) return;

    const videoTracks = peer.stream.getVideoTracks();
    if (videoTracks.length === 0) return;

    const videoTrack = videoTracks[0];
    const constraints = videoTrack.getConstraints();

    // Apply quality constraints
    const qualitySettings = {
      high: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      medium: {
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 25 },
      },
      low: {
        width: { ideal: 320 },
        height: { ideal: 180 },
        frameRate: { ideal: 15 },
      },
    };

    const settings = qualitySettings[quality];

    // Apply new constraints
    videoTrack
      .applyConstraints({
        ...constraints,
        ...settings,
      })
      .then(() => {
        console.log(
          `[WebRTC] Video quality set to ${quality} for peer ${peerId}`
        );
      })
      .catch((error) => {
        console.error(
          `[WebRTC] Failed to set video quality for peer ${peerId}:`,
          error
        );
      });
  }

  // Fallback ICE server configuration
  private initializeFallbackIceServers(): void {
    // Base STUN servers (always included)
    const stunServers: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
    ];

    // TURN server configuration from environment variables
    const turnUrl = import.meta.env.VITE_TURN_URL;
    const turnUsername = import.meta.env.VITE_TURN_USERNAME;
    const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

    // Start with STUN servers
    this.iceServers = [...stunServers];

    // Add TURN server if configured
    if (turnUrl && turnUsername && turnCredential) {
      try {
        // Validate TURN URL format
        if (!turnUrl.startsWith("turn:") && !turnUrl.startsWith("turns:")) {
          console.warn(
            "[WebRTC] Invalid TURN URL format, should start with turn: or turns:",
            turnUrl
          );
          return;
        }

        const turnServer: RTCIceServer = {
          urls: turnUrl,
          username: turnUsername,
          credential: turnCredential,
        };

        this.iceServers.push(turnServer);
        console.log(
          "[WebRTC] TURN server configured from environment:",
          turnUrl
        );
      } catch (error) {
        console.error("[WebRTC] Error configuring TURN server:", error);
        console.log("[WebRTC] Falling back to STUN servers only");
      }
    } else {
      console.log(
        "[WebRTC] TURN server not configured in environment, using STUN servers only"
      );
    }

    // Set basic ICE configuration
    this.iceConfiguration = {
      iceServers: this.iceServers,
      iceCandidatePoolSize: 10,
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    };

    // Log final ICE server configuration (without credentials)
    const iceServerInfo = this.iceServers.map((server) => ({
      urls: server.urls,
      hasCredential: !!server.credential,
      username: server.username ? "***" : undefined,
    }));
    console.log("[WebRTC] Fallback ICE servers configured:", iceServerInfo);
  }

  async connect(): Promise<void> {
    try {
      await this.wsClient.connect();
      // Set local peer ID from WebSocket client
      this.localPeerId = this.wsClient.getClientId();
      console.log("[WebRTC] Local peer ID set:", this.localPeerId);

      // Start quality monitoring
      this.startQualityMonitoring();
    } catch (error) {
      this.options.onError?.(error as Error);
      throw error;
    }
  }

  private handleWebSocketConnect(): void {
    console.log("[WebRTC] WebSocket connected, joining meeting");
    this.wsClient.join();
  }

  private handleWebSocketDisconnect(): void {
    console.log("[WebRTC] WebSocket disconnected");
  }

  private handleWebSocketError(error: Error): void {
    console.error("[WebRTC] WebSocket error:", error);
    this.options.onError?.(error);
  }

  private handleParticipantJoined(payload: JoinPayload): void {
    console.log("[WebRTC] Participant joined:", payload);
    console.log(
      "[WebRTC] Current peers before handling join:",
      Array.from(this.peers.keys())
    );
    console.log("[WebRTC] Current peers count:", this.peers.size);

    // Enhanced handling for Anonymous User detection
    if (payload.name === "Anonymous User") {
      console.warn(
        "[WebRTC] WARNING: Received 'Anonymous User' - this indicates backend identification issue"
      );
      console.warn("[WebRTC] Participant details:", {
        participantId: payload.participantId,
        name: payload.name,
        isAuthenticated: payload.isAuthenticated,
      });

      // Optional: Implement retry mechanism for user info refresh
      this.scheduleUserInfoRefresh(payload.participantId);
    }

    // Check if we already have an emergency connection for this peer
    const existingPeer = this.peers.get(payload.participantId);
    if (existingPeer) {
      console.log(
        "[WebRTC] FOUND EXISTING PEER - Updating existing peer connection with participant info:",
        payload.participantId
      );
      console.log("[WebRTC] Existing peer details:", {
        id: existingPeer.id,
        name: existingPeer.name,
        isAuthenticated: existingPeer.isAuthenticated,
        isEmergency: existingPeer.isEmergency,
        signalingState: existingPeer.connection.signalingState,
        connectionState: existingPeer.connection.connectionState,
      });

      // If this is an emergency connection, we need to handle the transition properly
      if (existingPeer.isEmergency) {
        console.log(
          "[WebRTC] TRANSITIONING EMERGENCY CONNECTION TO NORMAL for:",
          payload.participantId
        );

        // Update the emergency connection with correct info
        const oldName = existingPeer.name;
        const oldAuth = existingPeer.isAuthenticated;
        existingPeer.name = payload.name;
        existingPeer.isAuthenticated = payload.isAuthenticated;
        existingPeer.isEmergency = false; // Mark as normal connection now

        console.log("[WebRTC] Emergency connection transitioned to normal:", {
          peerId: payload.participantId,
          oldName,
          newName: payload.name,
          oldAuth,
          newAuth: payload.isAuthenticated,
          signalingState: existingPeer.connection.signalingState,
        });

        // If the connection is in stable state, we might need to recreate it
        // to ensure proper WebRTC signaling flow
        if (existingPeer.connection.signalingState === "stable") {
          console.log(
            "[WebRTC] Emergency connection is in stable state, recreating connection for:",
            payload.participantId
          );
          this.recreatePeerConnection(
            payload.participantId,
            payload.name,
            payload.isAuthenticated
          );
          return;
        }
      } else {
        // Update the existing normal connection with correct info
        const oldName = existingPeer.name;
        const oldAuth = existingPeer.isAuthenticated;
        existingPeer.name = payload.name;
        existingPeer.isAuthenticated = payload.isAuthenticated;

        console.log("[WebRTC] Updated normal peer info:", {
          peerId: payload.participantId,
          oldName,
          newName: payload.name,
          oldAuth,
          newAuth: payload.isAuthenticated,
        });
      }

      this.options.onPeerJoined?.(existingPeer);
    } else {
      console.log(
        "[WebRTC] NO EXISTING PEER - Creating new peer connection for participant:",
        payload.participantId
      );
      // Create new peer connection for new participant
      this.createPeerConnection(
        payload.participantId,
        payload.name,
        payload.isAuthenticated
      );
    }

    console.log(
      "[WebRTC] Current peers after handling join:",
      Array.from(this.peers.keys())
    );
  }

  private handleParticipantLeft(payload: LeavePayload): void {
    console.log("[WebRTC] Participant left:", payload);

    // Remove peer connection
    this.removePeerConnection(payload.participantId);
    this.options.onPeerLeft?.(payload.participantId);
  }

  private async handleSignalingMessage(
    message: SignalingMessage
  ): Promise<void> {
    console.log(
      "[WebRTC] Received signaling message:",
      message.type,
      "from:",
      message.from
    );

    try {
      switch (message.type) {
        case "offer":
          await this.handleOffer(
            message.from,
            message.data as RTCSessionDescriptionInit
          );
          break;
        case "answer":
          await this.handleAnswer(
            message.from,
            message.data as RTCSessionDescriptionInit
          );
          break;
        case "ice-candidate":
          await this.handleIceCandidate(
            message.from,
            message.data as RTCIceCandidateInit
          );
          break;
        default:
          console.log("[WebRTC] Ignoring message type:", message.type);
      }
    } catch (error) {
      console.error("[WebRTC] Error handling signaling message:", error);
      this.options.onError?.(error as Error);
    }
  }

  private async createPeerConnection(
    peerId: string,
    name: string,
    isAuthenticated: boolean
  ): Promise<void> {
    console.log("[WebRTC] createPeerConnection called for:", peerId);
    console.log(
      "[WebRTC] Current peers before creating:",
      Array.from(this.peers.keys())
    );
    console.log("[WebRTC] Current peers count:", this.peers.size);

    if (this.peers.has(peerId)) {
      console.log("[WebRTC] Peer connection already exists for:", peerId);
      const existingPeer = this.peers.get(peerId);
      console.log("[WebRTC] Existing peer details:", {
        id: existingPeer?.id,
        name: existingPeer?.name,
        isAuthenticated: existingPeer?.isAuthenticated,
        signalingState: existingPeer?.connection.signalingState,
        connectionState: existingPeer?.connection.connectionState,
      });
      return;
    }

    console.log("[WebRTC] CREATING NORMAL PEER CONNECTION for:", peerId);
    console.log("[WebRTC] Peer info:", { name, isAuthenticated });

    // Create RTCPeerConnection with enhanced ICE configuration
    const configuration: RTCConfiguration = {
      iceServers: this.iceServers,
      iceCandidatePoolSize: 10, // Pre-gather ICE candidates for faster connection
      iceTransportPolicy: "all", // Allow both relay (TURN) and direct connections
    };

    const peerConnection = new RTCPeerConnection(configuration);

    // Add local stream tracks to the peer connection
    this.options.localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, this.options.localStream);
    });

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[WebRTC] Sending ICE candidate to:", peerId);
        this.wsClient.sendIceCandidate(peerId, event.candidate);
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log(
        "[WebRTC] Connection state for",
        peerId,
        ":",
        peerConnection.connectionState
      );
      this.options.onPeerStateChange?.(peerId, peerConnection.connectionState);

      // Remove peer if connection is closed or failed
      if (
        peerConnection.connectionState === "closed" ||
        peerConnection.connectionState === "failed"
      ) {
        this.removePeerConnection(peerId);
      }
    };

    // Handle ICE connection state changes for TURN server monitoring
    peerConnection.oniceconnectionstatechange = () => {
      const iceState = peerConnection.iceConnectionState;
      console.log("[WebRTC] ICE connection state for", peerId, ":", iceState);

      // Handle TURN server specific states
      switch (iceState) {
        case "connected":
          console.log("[WebRTC] ICE connection established for", peerId);
          break;
        case "completed":
          console.log("[WebRTC] ICE connection completed for", peerId);
          break;
        case "failed":
          console.error("[WebRTC] ICE connection failed for", peerId);
          this.handleIceConnectionFailure(peerId, iceState);
          break;
        case "disconnected":
          console.warn("[WebRTC] ICE connection disconnected for", peerId);
          break;
        case "closed":
          console.log("[WebRTC] ICE connection closed for", peerId);
          break;
      }
    };

    // Handle ICE gathering state changes
    peerConnection.onicegatheringstatechange = () => {
      const gatheringState = peerConnection.iceGatheringState;
      console.log(
        "[WebRTC] ICE gathering state for",
        peerId,
        ":",
        gatheringState
      );

      if (gatheringState === "complete") {
        console.log("[WebRTC] ICE gathering completed for", peerId);
        this.logIceCandidates(peerId, peerConnection);
      }
    };

    // Handle remote streams
    peerConnection.ontrack = (event) => {
      console.log("[WebRTC] Received remote stream from:", peerId);
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];

        // Update peer connection with remote stream
        const peer = this.peers.get(peerId);
        if (peer) {
          peer.stream = stream;
        }

        this.options.onRemoteStream?.(peerId, stream);
      }
    };

    // Store peer connection
    const now = Date.now();
    const peerConnectionInfo: PeerConnection = {
      id: peerId,
      name,
      isAuthenticated,
      connection: peerConnection,
      isEmergency: false, // Mark as normal connection
      lastOffer: undefined, // Will be set when offer is created
      createdAt: now,
      lastActivity: now,
    };

    this.peers.set(peerId, peerConnectionInfo);
    console.log(
      "[WebRTC] Peer connection stored. Current peers:",
      Array.from(this.peers.keys())
    );
    this.options.onPeerJoined?.(peerConnectionInfo);

    // Create and send offer if we are the initiator
    console.log("[WebRTC] Creating and sending offer for new peer:", peerId);
    await this.createAndSendOffer(peerId);
  }

  private async recreatePeerConnection(
    peerId: string,
    name: string,
    isAuthenticated: boolean
  ): Promise<void> {
    console.log("[WebRTC] Recreating peer connection for:", peerId);
    console.log("[WebRTC] Removing old connection before recreation");

    const oldPeer = this.peers.get(peerId);
    if (oldPeer) {
      console.log("[WebRTC] Old peer details before recreation:", {
        peerId,
        name: oldPeer.name,
        isAuthenticated: oldPeer.isAuthenticated,
        isEmergency: oldPeer.isEmergency,
        signalingState: oldPeer.connection.signalingState,
        connectionState: oldPeer.connection.connectionState,
        createdAt: oldPeer.createdAt,
        lastActivity: oldPeer.lastActivity,
      });
    }

    // Remove the old connection first
    this.removePeerConnection(peerId);

    // Wait a bit to ensure cleanup
    await new Promise((resolve) => {
      const timeoutId = setTimeout(resolve, 100);
      this.activeTimeouts.add(timeoutId);
      setTimeout(() => this.activeTimeouts.delete(timeoutId), 200);
    });

    // Create new connection
    console.log("[WebRTC] Creating new connection after cleanup");
    await this.createPeerConnection(peerId, name, isAuthenticated);

    console.log("[WebRTC] Peer connection recreation completed for:", peerId);
  }

  private async createAndSendOffer(peerId: string): Promise<void> {
    try {
      const peer = this.peers.get(peerId);
      if (!peer) {
        throw new Error(`Peer connection not found for ${peerId}`);
      }

      console.log("[WebRTC] Creating offer for:", peerId);
      console.log(
        "[WebRTC] Connection state before createOffer:",
        peer.connection.signalingState
      );
      const offer = await peer.connection.createOffer();
      console.log(
        "[WebRTC] Connection state after createOffer:",
        peer.connection.signalingState
      );

      // Store the offer for duplicate detection and state tracking
      peer.lastOffer = offer;

      console.log("[WebRTC] Setting local description for:", peerId);
      console.log(
        "[WebRTC] Connection state before setLocalDescription:",
        peer.connection.signalingState
      );
      await peer.connection.setLocalDescription(offer);
      console.log(
        "[WebRTC] Connection state after setLocalDescription:",
        peer.connection.signalingState
      );

      console.log("[WebRTC] Sending offer to:", peerId);
      this.wsClient.sendOffer(peerId, offer);
    } catch (error) {
      console.error("[WebRTC] Error creating offer:", error);
      this.options.onError?.(error as Error);
    }
  }

  private async handleOffer(
    fromPeerId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<void> {
    try {
      console.log("[WebRTC] handleOffer called for:", fromPeerId);
      console.log("[WebRTC] Current peers:", Array.from(this.peers.keys()));
      console.log("[WebRTC] Offer details:", {
        type: offer.type,
        sdp: offer.sdp?.substring(0, 100) + "...",
      });

      const peer = this.peers.get(fromPeerId);
      if (!peer) {
        console.log(
          "[WebRTC] Received offer from unknown peer, creating emergency connection:",
          fromPeerId
        );
        // Create emergency peer connection for unknown peer
        await this.createPeerConnectionForUnknownPeer(fromPeerId, offer);
        return;
      }

      // Update last activity timestamp
      peer.lastActivity = Date.now();

      console.log("[WebRTC] Handling offer from existing peer:", fromPeerId);
      console.log("[WebRTC] Peer details:", {
        id: peer.id,
        name: peer.name,
        isAuthenticated: peer.isAuthenticated,
        isEmergency: peer.isEmergency,
        signalingState: peer.connection.signalingState,
        connectionState: peer.connection.connectionState,
        createdAt: peer.createdAt,
        lastActivity: peer.lastActivity,
        hasLastOffer: !!peer.lastOffer,
      });

      // Enhanced duplicate offer detection
      if (peer.lastOffer && peer.lastOffer.sdp === offer.sdp) {
        console.log("[WebRTC] Duplicate offer detected, ignoring:", fromPeerId);
        console.log("[WebRTC] Last offer was created at:", peer.lastActivity);
        return;
      }

      // Store the offer for duplicate detection and state tracking
      peer.lastOffer = offer;
      peer.lastActivity = Date.now();

      // Enhanced connection state validation
      const currentState = peer.connection.signalingState;
      console.log(
        "[WebRTC] Connection state before setRemoteDescription:",
        currentState
      );

      // If connection is in stable state, we might need to handle it differently
      if (currentState === "stable") {
        console.log(
          "[WebRTC] Connection is in stable state, checking if we need to recreate:",
          fromPeerId
        );

        // For emergency connections in stable state, recreate to ensure proper flow
        if (peer.isEmergency) {
          console.log(
            "[WebRTC] Recreating emergency connection in stable state:",
            fromPeerId
          );
          await this.recreatePeerConnection(
            fromPeerId,
            peer.name,
            peer.isAuthenticated
          );
          // After recreation, we need to handle the offer again with the new connection
          console.log(
            "[WebRTC] Re-handling offer after recreation:",
            fromPeerId
          );
          await this.handleOffer(fromPeerId, offer);
          return;
        }

        // For normal connections, we can proceed but might need to renegotiate
        console.log(
          "[WebRTC] Normal connection in stable state, proceeding with offer:",
          fromPeerId
        );
      }

      // Additional state validation for other problematic states
      const problematicStates = ["closed", "failed", "disconnected"];
      if (problematicStates.includes(currentState)) {
        console.log(
          "[WebRTC] Connection is in problematic state, recreating:",
          fromPeerId,
          currentState
        );
        await this.recreatePeerConnection(
          fromPeerId,
          peer.name,
          peer.isAuthenticated
        );
        // After recreation, we need to handle the offer again with the new connection
        console.log(
          "[WebRTC] Re-handling offer after recreation due to problematic state:",
          fromPeerId
        );
        await this.handleOffer(fromPeerId, offer);
        return;
      }

      console.log("[WebRTC] Setting remote description for:", fromPeerId);
      await peer.connection.setRemoteDescription(
        new RTCSessionDescription(offer)
      );

      console.log(
        "[WebRTC] Connection state after setRemoteDescription:",
        peer.connection.signalingState
      );

      // Create and send answer
      console.log("[WebRTC] Creating answer for:", fromPeerId);
      const answer = await peer.connection.createAnswer();
      console.log(
        "[WebRTC] Connection state after createAnswer:",
        peer.connection.signalingState
      );

      console.log("[WebRTC] Setting local description for:", fromPeerId);
      await peer.connection.setLocalDescription(answer);
      console.log(
        "[WebRTC] Connection state after setLocalDescription:",
        peer.connection.signalingState
      );

      console.log("[WebRTC] Sending answer to:", fromPeerId);
      this.wsClient.sendAnswer(fromPeerId, answer);

      console.log(
        "[WebRTC] Offer handling completed successfully for:",
        fromPeerId
      );
    } catch (error) {
      console.error("[WebRTC] Error handling offer:", error);

      // Enhanced error reporting
      if (error instanceof Error) {
        console.error("[WebRTC] Error details:", {
          name: error.name,
          message: error.message,
          stack: error.stack,
        });
      }

      this.options.onError?.(error as Error);
    }
  }

  private async createPeerConnectionForUnknownPeer(
    peerId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<void> {
    console.log(
      "[WebRTC] createPeerConnectionForUnknownPeer called for:",
      peerId
    );
    console.log(
      "[WebRTC] Current peers before creating emergency connection:",
      Array.from(this.peers.keys())
    );
    console.log("[WebRTC] Current peers count:", this.peers.size);
    console.log("[WebRTC] Offer details:", {
      type: offer.type,
      sdp: offer.sdp?.substring(0, 100) + "...",
    });

    if (this.peers.has(peerId)) {
      console.log(
        "[WebRTC] Peer connection already exists for unknown peer:",
        peerId
      );
      const existingPeer = this.peers.get(peerId);
      console.log("[WebRTC] Existing peer details:", {
        id: existingPeer?.id,
        name: existingPeer?.name,
        isAuthenticated: existingPeer?.isAuthenticated,
        isEmergency: existingPeer?.isEmergency,
        signalingState: existingPeer?.connection.signalingState,
        connectionState: existingPeer?.connection.connectionState,
        createdAt: existingPeer?.createdAt,
        lastActivity: existingPeer?.lastActivity,
      });

      // If existing connection is also emergency, we might need to recreate it
      if (existingPeer?.isEmergency) {
        console.log(
          "[WebRTC] Emergency connection already exists, recreating for unknown peer:",
          peerId
        );
        await this.recreatePeerConnection(
          peerId,
          existingPeer.name,
          existingPeer.isAuthenticated
        );
        // Handle the offer with the new connection
        const newPeer = this.peers.get(peerId);
        if (newPeer) {
          await newPeer.connection.setRemoteDescription(
            new RTCSessionDescription(offer)
          );
          const answer = await newPeer.connection.createAnswer();
          await newPeer.connection.setLocalDescription(answer);
          this.wsClient.sendAnswer(peerId, answer);
        }
      }
      return;
    }

    console.log(
      "[WebRTC] CREATING EMERGENCY PEER CONNECTION for unknown peer:",
      peerId
    );
    console.warn(
      "[WebRTC] WARNING: Emergency connection created for unknown peer - this may indicate backend user identification issues"
    );

    // Create RTCPeerConnection with enhanced ICE configuration
    const configuration: RTCConfiguration = {
      iceServers: this.iceServers,
      iceCandidatePoolSize: 10, // Pre-gather ICE candidates for faster connection
      iceTransportPolicy: "all", // Allow both relay (TURN) and direct connections
    };

    const peerConnection = new RTCPeerConnection(configuration);

    // Add local stream tracks to the peer connection
    this.options.localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, this.options.localStream);
    });

    // Enhanced ICE candidate handling
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[WebRTC] Sending ICE candidate to unknown peer:", peerId);
        this.wsClient.sendIceCandidate(peerId, event.candidate);
      }
    };

    // Enhanced connection state change handling
    peerConnection.onconnectionstatechange = () => {
      console.log(
        "[WebRTC] Connection state for unknown peer",
        peerId,
        ":",
        peerConnection.connectionState
      );

      const peer = this.peers.get(peerId);
      if (peer) {
        peer.lastActivity = Date.now();
      }

      this.options.onPeerStateChange?.(peerId, peerConnection.connectionState);

      // Remove peer if connection is closed or failed
      if (
        peerConnection.connectionState === "closed" ||
        peerConnection.connectionState === "failed"
      ) {
        console.log(
          "[WebRTC] Emergency connection failed/closed, removing:",
          peerId
        );
        this.removePeerConnection(peerId);
      }
    };

    // Handle ICE connection state changes for TURN server monitoring (emergency connection)
    peerConnection.oniceconnectionstatechange = () => {
      const iceState = peerConnection.iceConnectionState;
      console.log(
        "[WebRTC] ICE connection state for emergency peer",
        peerId,
        ":",
        iceState
      );

      // Handle TURN server specific states
      switch (iceState) {
        case "connected":
          console.log(
            "[WebRTC] Emergency ICE connection established for",
            peerId
          );
          break;
        case "completed":
          console.log(
            "[WebRTC] Emergency ICE connection completed for",
            peerId
          );
          break;
        case "failed":
          console.error("[WebRTC] Emergency ICE connection failed for", peerId);
          this.handleIceConnectionFailure(peerId, iceState);
          break;
        case "disconnected":
          console.warn(
            "[WebRTC] Emergency ICE connection disconnected for",
            peerId
          );
          break;
        case "closed":
          console.log("[WebRTC] Emergency ICE connection closed for", peerId);
          break;
      }
    };

    // Handle ICE gathering state changes (emergency connection)
    peerConnection.onicegatheringstatechange = () => {
      const gatheringState = peerConnection.iceGatheringState;
      console.log(
        "[WebRTC] Emergency ICE gathering state for",
        peerId,
        ":",
        gatheringState
      );

      if (gatheringState === "complete") {
        console.log("[WebRTC] Emergency ICE gathering completed for", peerId);
        this.logIceCandidates(peerId, peerConnection);
      }
    };

    // Enhanced remote stream handling
    peerConnection.ontrack = (event) => {
      console.log("[WebRTC] Received remote stream from unknown peer:", peerId);
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];

        // Update peer connection with remote stream
        const peer = this.peers.get(peerId);
        if (peer) {
          peer.stream = stream;
          peer.lastActivity = Date.now();
        }

        this.options.onRemoteStream?.(peerId, stream);
      }
    };

    // Store peer connection with minimal info (will be updated when participant-joined event arrives)
    const now = Date.now();
    const tempName = `Unknown User ${peerId.slice(-4)}`; // Temporary name

    const peerConnectionInfo: PeerConnection = {
      id: peerId,
      name: tempName,
      isAuthenticated: false, // Default to false until confirmed
      connection: peerConnection,
      isEmergency: true, // Mark as emergency connection
      lastOffer: offer, // Store the offer for state tracking
      createdAt: now,
      lastActivity: now,
    };

    this.peers.set(peerId, peerConnectionInfo);

    console.log(
      "[WebRTC] Emergency peer connection created, notifying callback"
    );
    this.options.onPeerJoined?.(peerConnectionInfo);

    try {
      // Set remote description from the received offer
      console.log(
        "[WebRTC] Setting remote description from offer for unknown peer:",
        peerId
      );
      console.log(
        "[WebRTC] Connection state before setRemoteDescription:",
        peerConnection.signalingState
      );
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer)
      );
      console.log(
        "[WebRTC] Connection state after setRemoteDescription:",
        peerConnection.signalingState
      );

      // Create and send answer
      console.log("[WebRTC] Creating answer for unknown peer:", peerId);
      const answer = await peerConnection.createAnswer();
      console.log(
        "[WebRTC] Setting local description for unknown peer:",
        peerId
      );
      console.log(
        "[WebRTC] Connection state before setLocalDescription:",
        peerConnection.signalingState
      );
      await peerConnection.setLocalDescription(answer);
      console.log(
        "[WebRTC] Connection state after setLocalDescription:",
        peerConnection.signalingState
      );

      console.log("[WebRTC] Sending answer to unknown peer:", peerId);
      this.wsClient.sendAnswer(peerId, answer);

      console.log("[WebRTC] Emergency connection setup completed for:", peerId);
    } catch (error) {
      console.error(
        "[WebRTC] Error setting up emergency connection for:",
        peerId,
        error
      );

      // Clean up on error
      this.removePeerConnection(peerId);

      // Enhanced error reporting
      if (error instanceof Error) {
        console.error("[WebRTC] Emergency connection error details:", {
          name: error.name,
          message: error.message,
          stack: error.stack,
        });
      }

      this.options.onError?.(error as Error);
    }
  }

  private async handleAnswer(
    fromPeerId: string,
    answer: RTCSessionDescriptionInit
  ): Promise<void> {
    try {
      const peer = this.peers.get(fromPeerId);
      if (!peer) {
        console.error(
          "[WebRTC] Received answer from unknown peer:",
          fromPeerId
        );
        return;
      }

      // Update last activity timestamp
      peer.lastActivity = Date.now();

      // Log current state for debugging
      console.log("[WebRTC] Handling answer from:", fromPeerId);
      console.log(
        "[WebRTC] Peer connection state:",
        peer.connection.signalingState
      );
      console.log("[WebRTC] Peer connection exists:", !!peer);
      console.log("[WebRTC] Peer name:", peer.name);
      console.log("[WebRTC] Peer authenticated:", peer.isAuthenticated);
      console.log("[WebRTC] Peer isEmergency:", peer.isEmergency);
      console.log("[WebRTC] Current peers count:", this.peers.size);
      console.log("[WebRTC] All peer IDs:", Array.from(this.peers.keys()));

      // Enhanced state validation before setting remote description
      const currentState = peer.connection.signalingState;
      const validStates = ["have-local-offer", "have-remote-offer"];

      if (!validStates.includes(currentState)) {
        console.error(
          "[WebRTC] Invalid state for setRemoteDescription. Current state:",
          currentState,
          "Expected one of:",
          validStates
        );

        // Log additional debugging info
        console.log("[WebRTC] Connection details:", {
          peerId: fromPeerId,
          signalingState: currentState,
          connectionState: peer.connection.connectionState,
          iceConnectionState: peer.connection.iceConnectionState,
          iceGatheringState: peer.connection.iceGatheringState,
          isEmergency: peer.isEmergency,
          createdAt: peer.createdAt,
          lastActivity: peer.lastActivity,
          hasLastOffer: !!peer.lastOffer,
        });

        // Enhanced auto-recovery for emergency connections
        if (peer.isEmergency) {
          console.log(
            "[WebRTC] Attempting to recover emergency connection by recreating it:",
            fromPeerId
          );
          try {
            await this.recreatePeerConnection(
              fromPeerId,
              peer.name,
              peer.isAuthenticated
            );
            console.log(
              "[WebRTC] Emergency connection recovery completed for:",
              fromPeerId
            );
            return;
          } catch (recoveryError) {
            console.error(
              "[WebRTC] Failed to recover emergency connection:",
              recoveryError
            );
          }
        }

        // For normal connections, try to recreate as last resort
        console.log(
          "[WebRTC] Attempting to recover normal connection by recreating it:",
          fromPeerId
        );
        try {
          await this.recreatePeerConnection(
            fromPeerId,
            peer.name,
            peer.isAuthenticated
          );
          console.log(
            "[WebRTC] Normal connection recovery completed for:",
            fromPeerId
          );
          return;
        } catch (recoveryError) {
          console.error(
            "[WebRTC] Failed to recover normal connection:",
            recoveryError
          );
        }

        throw new Error(
          `Cannot set remote description in state: ${currentState}. Recovery failed.`
        );
      }

      console.log("[WebRTC] Setting remote description for:", fromPeerId);
      console.log("[WebRTC] Answer details:", {
        type: answer.type,
        sdp: answer.sdp?.substring(0, 100) + "...",
      });

      await peer.connection.setRemoteDescription(
        new RTCSessionDescription(answer)
      );

      console.log(
        "[WebRTC] Successfully set remote description. New state:",
        peer.connection.signalingState
      );

      // Clear last offer after successful answer processing
      peer.lastOffer = undefined;
    } catch (error) {
      console.error("[WebRTC] Error handling answer:", error);

      // Enhanced error reporting
      if (error instanceof Error) {
        console.error("[WebRTC] Error details:", {
          name: error.name,
          message: error.message,
          stack: error.stack,
        });
      }

      this.options.onError?.(error as Error);
    }
  }

  private async handleIceCandidate(
    fromPeerId: string,
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    try {
      const peer = this.peers.get(fromPeerId);
      if (!peer) {
        console.error(
          "[WebRTC] Received ICE candidate from unknown peer:",
          fromPeerId
        );
        return;
      }

      console.log("[WebRTC] Adding ICE candidate from:", fromPeerId);
      await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("[WebRTC] Error handling ICE candidate:", error);
      this.options.onError?.(error as Error);
    }
  }

  private removePeerConnection(peerId: string): void {
    console.log("[WebRTC] removePeerConnection called for:", peerId);
    console.log(
      "[WebRTC] Current peers before removal:",
      Array.from(this.peers.keys())
    );

    const peer = this.peers.get(peerId);
    if (peer) {
      console.log("[WebRTC] REMOVING PEER CONNECTION:", peerId);
      console.log("[WebRTC] Peer details before removal:", {
        id: peer.id,
        name: peer.name,
        isAuthenticated: peer.isAuthenticated,
        signalingState: peer.connection.signalingState,
        connectionState: peer.connection.connectionState,
      });

      // Use the enhanced cleanup method
      this.cleanupPeerConnection(peerId);

      // Release audio context for this peer
      this.releaseAudioContextForPeer(peerId);

      console.log(
        "[WebRTC] Peer connection removed. Current peers after removal:",
        Array.from(this.peers.keys())
      );

      // Notify about peer leaving
      this.options.onPeerLeft?.(peerId);
    } else {
      console.log("[WebRTC] No peer found to remove for:", peerId);
    }
  }

  // Public methods
  getPeers(): PeerConnection[] {
    return Array.from(this.peers.values());
  }

  getPeer(peerId: string): PeerConnection | undefined {
    return this.peers.get(peerId);
  }

  getPeerCount(): number {
    return this.peers.size;
  }

  updateLocalStream(newStream: MediaStream): void {
    this.options.localStream = newStream;

    // Update all peer connections with new stream
    this.peers.forEach((peer) => {
      // Remove old tracks and add new ones
      peer.connection.getSenders().forEach((sender) => {
        if (sender.track) {
          peer.connection.removeTrack(sender);
        }
      });

      newStream.getTracks().forEach((track) => {
        peer.connection.addTrack(track, newStream);
      });
    });
  }

  // Schedule user info refresh for Anonymous User detection
  private scheduleUserInfoRefresh(participantId: string): void {
    console.log(
      "[WebRTC] Scheduling user info refresh for participant:",
      participantId
    );

    // Retry mechanism: attempt to refresh user info after a delay
    const timeoutId = setTimeout(() => {
      this.activeTimeouts.delete(timeoutId);
      const peer = this.peers.get(participantId);
      if (peer && peer.name === "Anonymous User") {
        console.log("[WebRTC] Retrying user info refresh for:", participantId);
        // In a real implementation, you might want to:
        // 1. Request updated user info from backend
        // 2. Refresh participant list
        // 3. Update the peer information
        console.warn(
          "[WebRTC] User info refresh retry completed - still Anonymous User"
        );
      }
    }, 3000); // Retry after 3 seconds

    this.activeTimeouts.add(timeoutId);
  }

  /**
   * Get or create audio context for peer
   */
  private async getAudioContextForPeer(
    peerId: string
  ): Promise<PooledAudioContext> {
    if (this.audioContexts.has(peerId)) {
      const pooledContext = this.audioContexts.get(peerId)!;
      return pooledContext;
    }

    const pooledContext = await this.audioContextPool.acquire({
      sampleRate: 48000,
      latencyHint: "interactive",
    });

    this.audioContexts.set(peerId, pooledContext);
    console.log(`[WebRTC] AudioContext acquired for peer: ${peerId}`);

    return pooledContext;
  }

  /**
   * Release audio context for peer
   */
  private releaseAudioContextForPeer(peerId: string): void {
    const pooledContext = this.audioContexts.get(peerId);
    if (pooledContext) {
      this.audioContextPool.release(pooledContext.id);
      this.audioContexts.delete(peerId);
      console.log(`[WebRTC] AudioContext released for peer: ${peerId}`);
    }
  }

  // Cleanup logging utilities
  private logCleanup(activity: string, details?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [WebRTC-Cleanup] ${activity}${details ? ` - ${JSON.stringify(details)}` : ""}`;
    this.cleanupLog.push(logEntry);
    console.log(logEntry);
  }

  private getCleanupSummary(): string[] {
    return [
      `Cleanup Summary:`,
      `- Total log entries: ${this.cleanupLog.length}`,
      `- Active timeouts: ${this.activeTimeouts.size}`,
      `- Active peers: ${this.peers.size}`,
      `- Cleanup in progress: ${this.isCleanupInProgress}`,
      `- Service destroyed: ${this.isDestroyed}`,
      `Recent logs:`,
      ...this.cleanupLog.slice(-10),
    ];
  }

  // Comprehensive timeout cleanup
  private clearAllTimeouts(): void {
    this.logCleanup(`Clearing ${this.activeTimeouts.size} active timeouts`);

    this.activeTimeouts.forEach((timeoutId) => {
      clearTimeout(timeoutId);
    });

    this.activeTimeouts.clear();
    this.logCleanup("All timeouts cleared");
  }

  // Enhanced peer connection cleanup with event listener removal
  private cleanupPeerConnection(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) {
      this.logCleanup(`Peer ${peerId} not found for cleanup`);
      return;
    }

    this.logCleanup(`Starting cleanup for peer ${peerId}`, {
      name: peer.name,
      isAuthenticated: peer.isAuthenticated,
      isEmergency: peer.isEmergency,
      signalingState: peer.connection.signalingState,
      connectionState: peer.connection.connectionState,
      iceConnectionState: peer.connection.iceConnectionState,
    });

    try {
      // Remove all event listeners to prevent memory leaks
      peer.connection.onicecandidate = null;
      peer.connection.onconnectionstatechange = null;
      peer.connection.oniceconnectionstatechange = null;
      peer.connection.onicegatheringstatechange = null;
      peer.connection.ontrack = null;
      peer.connection.onsignalingstatechange = null;
      peer.connection.ondatachannel = null;

      this.logCleanup(`Event listeners removed for peer ${peerId}`);

      // Stop all tracks in remote stream if exists
      if (peer.stream) {
        peer.stream.getTracks().forEach((track) => {
          track.stop();
          this.logCleanup(`Track stopped for peer ${peerId}: ${track.kind}`);
        });
        peer.stream = undefined;
      }

      // Close the peer connection
      if (peer.connection.signalingState !== "closed") {
        peer.connection.close();
        this.logCleanup(`Peer connection closed for ${peerId}`);
      }

      // Remove from peers map
      this.peers.delete(peerId);
      this.logCleanup(`Peer ${peerId} removed from peers map`);
    } catch (error) {
      this.logCleanup(`Error during peer cleanup for ${peerId}`, error);
      console.error(
        `[WebRTC-Cleanup] Error cleaning up peer ${peerId}:`,
        error
      );
    }
  }

  // Enhanced WebSocket cleanup
  private cleanupWebSocket(): void {
    this.logCleanup("Starting WebSocket cleanup", {
      isConnected: this.wsClient.isConnected(),
      connectionState: this.wsClient.getConnectionState(),
    });

    try {
      // Destroy WebSocket client
      this.wsClient.destroy();
      this.logCleanup("WebSocket client destroyed");
    } catch (error) {
      this.logCleanup("Error during WebSocket cleanup", error);
      console.error("[WebRTC-Cleanup] Error cleaning up WebSocket:", error);
    }
  }

  // Enhanced local stream cleanup
  private cleanupLocalStream(): void {
    if (this.options.localStream) {
      this.logCleanup("Starting local stream cleanup", {
        tracks: this.options.localStream.getTracks().length,
      });

      try {
        this.options.localStream.getTracks().forEach((track) => {
          track.stop();
          this.logCleanup(`Local track stopped: ${track.kind}`);
        });
      } catch (error) {
        this.logCleanup("Error during local stream cleanup", error);
        console.error(
          "[WebRTC-Cleanup] Error cleaning up local stream:",
          error
        );
      }
    }
  }

  muteAudio(muted: boolean): void {
    this.options.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  muteVideo(muted: boolean): void {
    this.options.localStream.getVideoTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  // Handle ICE connection failures with fallback mechanism
  private handleIceConnectionFailure(
    peerId: string,
    iceState: RTCIceConnectionState
  ): void {
    console.error(
      "[WebRTC] ICE connection failure detected for",
      peerId,
      "with state:",
      iceState
    );

    const peer = this.peers.get(peerId);
    if (!peer) {
      console.error(
        "[WebRTC] Peer not found for ICE failure handling:",
        peerId
      );
      return;
    }

    // Log failure details for debugging
    console.error("[WebRTC] ICE failure details:", {
      peerId,
      iceState,
      connectionState: peer.connection.connectionState,
      signalingState: peer.connection.signalingState,
      iceGatheringState: peer.connection.iceGatheringState,
      hasTurnServer: this.iceServers.some(
        (server) => server.urls && (server.urls as string).includes("turn")
      ),
      timestamp: new Date().toISOString(),
    });

    // Check if TURN server is being used
    const hasTurnServer = this.iceServers.some(
      (server) => server.urls && (server.urls as string).startsWith("turn")
    );

    if (!hasTurnServer) {
      console.warn(
        "[WebRTC] No TURN server configured. Connection may fail in restrictive NAT environments."
      );
      console.warn(
        "[WebRTC] Consider configuring VITE_TURN_URL, VITE_TURN_USERNAME, and VITE_TURN_CREDENTIAL"
      );
    }

    // Attempt recovery based on failure type
    this.attemptConnectionRecovery(peerId);
  }

  // Log ICE candidates for debugging TURN server usage
  private logIceCandidates(
    peerId: string,
    peerConnection: RTCPeerConnection
  ): void {
    console.log("[WebRTC] ICE candidates gathered for", peerId);

    // Get local description to analyze candidates
    const localDescription = peerConnection.localDescription;
    if (!localDescription) {
      console.warn(
        "[WebRTC] No local description available for candidate analysis"
      );
      return;
    }

    // Parse SDP to extract candidate information
    const sdpLines = localDescription.sdp?.split("\n") || [];
    const candidates = sdpLines.filter((line) =>
      line.startsWith("a=candidate:")
    );

    if (candidates.length === 0) {
      console.warn("[WebRTC] No ICE candidates found");
      return;
    }

    console.log(
      `[WebRTC] Found ${candidates.length} ICE candidates for`,
      peerId
    );

    // Analyze candidate types
    const candidateTypes = {
      host: 0,
      srflx: 0, // STUN
      relay: 0, // TURN
    };

    candidates.forEach((candidate) => {
      if (candidate.includes("typ host")) candidateTypes.host++;
      else if (candidate.includes("typ srflx")) candidateTypes.srflx++;
      else if (candidate.includes("typ relay")) candidateTypes.relay++;
    });

    console.log(
      "[WebRTC] ICE candidate types for",
      peerId,
      ":",
      candidateTypes
    );

    // Check if TURN candidates are available
    if (candidateTypes.relay === 0) {
      const hasTurnConfigured = this.iceServers.some(
        (server) => server.urls && (server.urls as string).startsWith("turn")
      );

      if (hasTurnConfigured) {
        console.warn(
          "[WebRTC] TURN server configured but no relay candidates found"
        );
        console.warn(
          "[WebRTC] This may indicate TURN server connectivity issues"
        );
      } else {
        console.info(
          "[WebRTC] No TURN server configured, using direct connections only"
        );
      }
    } else {
      console.log(
        "[WebRTC] TURN relay candidates available - NAT traversal should work"
      );
    }
  }

  // Attempt connection recovery with fallback mechanism
  private async attemptConnectionRecovery(peerId: string): Promise<void> {
    console.log("[WebRTC] Attempting connection recovery for", peerId);

    const peer = this.peers.get(peerId);
    if (!peer) {
      console.error(
        "[WebRTC] Cannot recover connection - peer not found:",
        peerId
      );
      return;
    }

    try {
      // First, try to restart ICE gathering
      console.log("[WebRTC] Restarting ICE gathering for", peerId);
      await peer.connection.restartIce();

      // Wait a bit for ICE to restart
      await new Promise((resolve) => {
        const timeoutId = setTimeout(resolve, 2000);
        this.activeTimeouts.add(timeoutId);
        setTimeout(() => this.activeTimeouts.delete(timeoutId), 2100);
      });

      // Check if connection recovered
      if (
        peer.connection.iceConnectionState === "connected" ||
        peer.connection.iceConnectionState === "completed"
      ) {
        console.log("[WebRTC] Connection recovered successfully for", peerId);
        return;
      }

      // If ICE restart didn't work, try recreating the connection
      console.log(
        "[WebRTC] ICE restart failed, recreating connection for",
        peerId
      );
      await this.recreatePeerConnection(
        peerId,
        peer.name,
        peer.isAuthenticated
      );
    } catch (error) {
      console.error(
        "[WebRTC] Connection recovery failed for",
        peerId,
        ":",
        error
      );
      this.options.onError?.(error as Error);
    }
  }

  destroy(): void {
    if (this.isDestroyed) {
      this.logCleanup("Destroy called on already destroyed service");
      return;
    }

    if (this.isCleanupInProgress) {
      this.logCleanup("Destroy called while cleanup in progress");
      return;
    }

    this.isCleanupInProgress = true;
    this.logCleanup("Starting comprehensive WebRTC service destruction");

    try {
      // Mark as destroyed first to prevent new operations
      this.isDestroyed = true;

      // Clear quality monitoring
      if (this.qualityMonitoringInterval) {
        clearInterval(this.qualityMonitoringInterval);
        this.qualityMonitoringInterval = null;
      }

      // Step 1: Clear all timeouts
      this.clearAllTimeouts();

      // Step 2: Cleanup all peer connections with enhanced cleanup
      this.logCleanup(
        `Starting cleanup of ${this.peers.size} peer connections`
      );
      const peerIds = Array.from(this.peers.keys());
      peerIds.forEach((peerId) => {
        this.cleanupPeerConnection(peerId);
      });

      // Step 3: Cleanup WebSocket client
      this.cleanupWebSocket();

      // Step 4: Cleanup local stream
      this.cleanupLocalStream();

      // Step 5: Release all audio contexts
      for (const [peerId] of this.audioContexts) {
        this.releaseAudioContextForPeer(peerId);
      }
      this.audioContexts.clear();

      // Step 6: Clear references
      this.peers.clear();
      this.connectionMetrics.clear();
      this.localPeerId = null;

      // Step 7: Log final cleanup summary
      const summary = this.getCleanupSummary();
      summary.forEach((line) => console.log(`[WebRTC-Cleanup] ${line}`));

      this.logCleanup("WebRTC service destruction completed successfully");
    } catch (error) {
      this.logCleanup("Critical error during service destruction", error);
      console.error("[WebRTC-Cleanup] Critical error during destroy:", error);
    } finally {
      this.isCleanupInProgress = false;
    }
  }

  // Public method to get cleanup status (for debugging)
  getCleanupStatus(): {
    isDestroyed: boolean;
    isCleanupInProgress: boolean;
    activeTimeouts: number;
    activePeers: number;
    cleanupLog: string[];
  } {
    return {
      isDestroyed: this.isDestroyed,
      isCleanupInProgress: this.isCleanupInProgress,
      activeTimeouts: this.activeTimeouts.size,
      activePeers: this.peers.size,
      cleanupLog: [...this.cleanupLog],
    };
  }

  // Public method to force cleanup in case of emergency
  emergencyCleanup(): void {
    this.logCleanup("EMERGENCY CLEANUP INITIATED");

    try {
      // Force clear everything without proper sequence
      this.activeTimeouts.forEach(clearTimeout);
      this.activeTimeouts.clear();

      this.peers.forEach((peer, peerId) => {
        try {
          if (peer.connection && peer.connection.signalingState !== "closed") {
            peer.connection.close();
          }
        } catch (e) {
          // Ignore errors in emergency cleanup
        }
      });
      this.peers.clear();

      this.wsClient.destroy();

      this.options.localStream?.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          // Ignore errors in emergency cleanup
        }
      });

      this.isDestroyed = true;
      this.isCleanupInProgress = false;

      this.logCleanup("EMERGENCY CLEANUP COMPLETED");
    } catch (error) {
      console.error("[WebRTC-Cleanup] Emergency cleanup failed:", error);
    }
  }
}

// Factory function untuk membuat WebRTC service
export function createWebRTCService(
  options: WebRTCServiceOptions
): WebRTCService {
  return new WebRTCService(options);
}
