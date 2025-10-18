import {
  Participant,
  PeerConnectionState,
  WebRTCManagerConfig,
  WebRTCManagerEvents,
  SignalingMessage,
  OfferMessage,
  AnswerMessage,
  IceCandidateMessage,
  JoinMessage,
  LeaveMessage,
  ParticipantJoinedMessage,
  ParticipantLeftMessage,
  isOfferMessage,
  isAnswerMessage,
  isIceCandidateMessage,
  isJoinMessage,
  isLeaveMessage,
  isParticipantJoinedMessage,
  isParticipantLeftMessage,
} from "@/types/webrtc";
import { WebSocketService } from "./websocket-service";
import { iceServerManager } from "./ice-servers";

export class WebRTCManager {
  private config: WebRTCManagerConfig;
  private participants: Map<string, Participant> = new Map();
  private eventListeners: Map<keyof WebRTCManagerEvents, Function[]> =
    new Map();
  private rtcConfig: RTCConfiguration;
  private pendingIceCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private remoteDescriptionSet: Map<string, boolean> = new Map();
  private processedMessages: Set<string> = new Set();
  private messageCleanupInterval: NodeJS.Timeout | null = null;

  // State tracking for each participant
  private participantStateTracking: Map<
    string,
    {
      hasSentOffer: boolean;
      hasReceivedOffer: boolean;
      hasSentAnswer: boolean;
      hasReceivedAnswer: boolean;
      isOfferer: boolean;
    }
  > = new Map();

  constructor(config: WebRTCManagerConfig) {
    this.config = config;

    // Initialize with basic STUN servers, will be enhanced with TURN servers
    this.rtcConfig = {
      iceServers: config.rtcConfig?.iceServers || [
        {
          urls: [
            "stun:stun1.l.google.com:19302",
            "stun:stun2.l.google.com:19302",
          ],
        },
      ],
      iceCandidatePoolSize: config.rtcConfig?.iceCandidatePoolSize || 10,
    };

    this.setupWebSocketListeners();
    this.setupMessageCleanup();
  }

  /**
   * Initialize WebRTC manager and join meeting
   */
  async initialize(): Promise<void> {
    try {
      // Initialize ICE servers with TURN support
      await this.initializeICEServers();

      // Connect to WebSocket if not already connected
      if (this.config.webSocketService.getState() === "disconnected") {
        await this.config.webSocketService.connect();
      }

      // Send join message to announce our presence
      this.sendMessage({
        type: "join",
        meetingId: this.getMeetingId(),
        from: this.config.participantId,
        data: {
          participantId: this.config.participantId,
          participantName: this.config.participantName,
        },
      });
    } catch (error) {
      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Cleanup all connections and resources
   */
  cleanup(): void {
    // Send leave message
    this.sendMessage({
      type: "leave",
      meetingId: this.getMeetingId(),
      from: this.config.participantId,
      data: {
        participantId: this.config.participantId,
      },
    });

    // Close all peer connections
    this.participants.forEach((participant) => {
      if (participant.peerConnection) {
        participant.peerConnection.close();
      }
    });

    this.participants.clear();

    // Clear buffered ICE candidates
    this.pendingIceCandidates.clear();
    this.remoteDescriptionSet.clear();

    // Clear state tracking
    this.participantStateTracking.clear();

    // Clear message tracking
    this.processedMessages.clear();
    if (this.messageCleanupInterval) {
      clearInterval(this.messageCleanupInterval);
      this.messageCleanupInterval = null;
    }

    console.log(
      "[WebRTC] Cleanup completed - all connections and state tracking cleared"
    );
  }

  /**
   * Get all participants
   */
  getParticipants(): Participant[] {
    return Array.from(this.participants.values());
  }

  /**
   * Get participant by ID
   */
  getParticipant(participantId: string): Participant | undefined {
    return this.participants.get(participantId);
  }

  /**
   * Add event listener
   */
  on<K extends keyof WebRTCManagerEvents>(
    event: K,
    callback: WebRTCManagerEvents[K]
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof WebRTCManagerEvents>(
    event: K,
    callback: WebRTCManagerEvents[K]
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Setup WebSocket event listeners
   */
  private setupWebSocketListeners(): void {
    this.config.webSocketService.on("message", (message: SignalingMessage) => {
      this.handleSignalingMessage(message);
    });

    this.config.webSocketService.on("error", (error: Error) => {
      this.emit("error", error);
    });
  }

  /**
   * Handle incoming signaling messages
   */
  private async handleSignalingMessage(
    message: SignalingMessage
  ): Promise<void> {
    try {
      // Generate message ID for deduplication
      const messageId = this.generateMessageId(message);

      // Check if message has already been processed
      if (this.isMessageProcessed(messageId)) {
        console.log(`[WebRTC] Skipping duplicate message: ${messageId}`);
        return;
      }

      console.log(
        `[WebRTC] Processing message: ${messageId}, type: ${message.type}, from: ${message.from}`
      );

      if (isJoinMessage(message)) {
        console.log("[DEBUG] WebRTC handling join message");
        await this.handleJoinMessage(message);
      } else if (isLeaveMessage(message)) {
        console.log("[DEBUG] WebRTC handling leave message");
        await this.handleLeaveMessage(message);
      } else if (isParticipantJoinedMessage(message)) {
        console.log("[DEBUG] WebRTC handling participant-joined message");
        await this.handleParticipantJoinedMessage(message);
      } else if (isParticipantLeftMessage(message)) {
        console.log("[DEBUG] WebRTC handling participant-left message");
        await this.handleParticipantLeftMessage(message);
      } else if (isOfferMessage(message)) {
        console.log("[DEBUG] WebRTC handling offer message");
        await this.handleOfferMessage(message);
      } else if (isAnswerMessage(message)) {
        console.log("[DEBUG] WebRTC handling answer message");
        await this.handleAnswerMessage(message);
      } else if (isIceCandidateMessage(message)) {
        console.log("[DEBUG] WebRTC handling ice-candidate message");
        await this.handleIceCandidateMessage(message);
      } else {
        // Forward unknown message types (including chat messages) to chat service
        console.log(
          "[DEBUG] WebRTC forwarding message to chat service:",
          (message as any).type
        );
        this.emit("chat-message", message);
      }
    } catch (error) {
      const participantId = message.from || "unknown";
      this.handleWebRTCError(
        error as Error,
        participantId,
        `handleSignalingMessage(${message.type})`
      );
    }
  }

  /**
   * Handle join message - create peer connection and send offer
   */
  private async handleJoinMessage(message: JoinMessage): Promise<void> {
    const { participantId, participantName } = message.data;

    // Don't create connection for ourselves
    if (participantId === this.config.participantId) {
      return;
    }

    // Initialize state tracking for this participant
    this.initializeParticipantStateTracking(participantId);

    // Create peer connection
    const peerConnection = this.createPeerConnection(participantId);

    // Add local stream tracks
    this.config.localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, this.config.localStream);
    });

    // Check if we should be the offerer
    const tracking = this.participantStateTracking.get(participantId);
    if (tracking?.isOfferer) {
      console.log(
        `[WebRTC] Creating offer for joining participant ${participantId} (we are offerer)`
      );

      // Create and send offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      this.sendMessage({
        type: "offer",
        meetingId: this.getMeetingId(),
        from: this.config.participantId,
        to: participantId,
        data: { sdp: offer },
      });

      // Update state tracking
      this.updateParticipantState(participantId, "sentOffer");
    } else {
      console.log(
        `[WebRTC] Waiting for offer from joining participant ${participantId} (we are answerer)`
      );
    }

    // Add participant to our list
    const participant: Participant = {
      id: participantId,
      name: participantName,
      peerConnection,
      connectionState: this.getPeerConnectionState(peerConnection),
    };

    this.participants.set(participantId, participant);
  }

  /**
   * Handle leave message
   */
  private async handleLeaveMessage(message: LeaveMessage): Promise<void> {
    const { participantId } = message.data;
    this.removeParticipant(participantId);
  }

  /**
   * Handle participant joined message
   */
  private async handleParticipantJoinedMessage(
    message: ParticipantJoinedMessage
  ): Promise<void> {
    const { participantId, participantName } = message.data;

    // Don't create connection for ourselves
    if (participantId === this.config.participantId) {
      return;
    }

    // Initialize state tracking for this participant
    this.initializeParticipantStateTracking(participantId);

    // Create peer connection for new participant
    const peerConnection = this.createPeerConnection(participantId);

    // Add local stream tracks
    this.config.localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, this.config.localStream);
    });

    // Check if we should be the offerer
    const tracking = this.participantStateTracking.get(participantId);
    if (tracking?.isOfferer) {
      console.log(
        `[WebRTC] Creating offer for new participant ${participantId} (we are offerer)`
      );

      // Create and send offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      this.sendMessage({
        type: "offer",
        meetingId: this.getMeetingId(),
        from: this.config.participantId,
        to: participantId,
        data: { sdp: offer },
      });

      // Update state tracking
      this.updateParticipantState(participantId, "sentOffer");
    } else {
      console.log(
        `[WebRTC] Waiting for offer from ${participantId} (we are answerer)`
      );
    }

    // Add participant to our list
    const participant: Participant = {
      id: participantId,
      name: participantName,
      peerConnection,
      connectionState: this.getPeerConnectionState(peerConnection),
    };

    this.participants.set(participantId, participant);
    this.emit("participant-joined", participant);
  }

  /**
   * Handle participant left message
   */
  private async handleParticipantLeftMessage(
    message: ParticipantLeftMessage
  ): Promise<void> {
    const { participantId } = message.data;
    this.removeParticipant(participantId);
    this.emit("participant-left", participantId);
  }

  /**
   * Handle offer message
   */
  private async handleOfferMessage(message: OfferMessage): Promise<void> {
    const { from: participantId } = message;

    if (!participantId || participantId === this.config.participantId) {
      return;
    }

    console.log(`[WebRTC] Processing offer message from ${participantId}`);

    // Initialize state tracking if not exists
    if (!this.participantStateTracking.has(participantId)) {
      this.initializeParticipantStateTracking(participantId);
    }

    let participant = this.participants.get(participantId);
    let peerConnection: RTCPeerConnection;

    if (!participant) {
      // Create new peer connection
      peerConnection = this.createPeerConnection(participantId);

      // Add local stream tracks
      this.config.localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, this.config.localStream);
      });

      participant = {
        id: participantId,
        name: participantId, // Will be updated when we get participant info
        peerConnection,
        connectionState: this.getPeerConnectionState(peerConnection),
      };

      this.participants.set(participantId, participant);
    } else {
      peerConnection = participant.peerConnection!;
    }

    const currentState = peerConnection.signalingState;

    // Log detailed state information for debugging
    console.log(`[WebRTC] Offer processing details for ${participantId}:`, {
      signalingState: currentState,
      remoteDescription: !!peerConnection.remoteDescription,
      localDescription: !!peerConnection.localDescription,
      pendingIceCandidates:
        this.pendingIceCandidates.get(participantId)?.length || 0,
      remoteDescriptionSet:
        this.remoteDescriptionSet.get(participantId) || false,
    });

    // Validate state before setting remote description
    if (
      !this.validateStateForSetRemoteDescription(
        peerConnection,
        "offer",
        participantId
      )
    ) {
      console.warn(
        `[WebRTC] Invalid state for offer from ${participantId}, attempting reset`
      );
      await this.resetPeerConnection(participantId);
      return;
    }

    try {
      console.log(
        `[WebRTC] Setting remote description (offer) for ${participantId} in state: ${currentState}`
      );
      await peerConnection.setRemoteDescription(message.data.sdp);

      // Update state tracking
      this.updateParticipantState(participantId, "receivedOffer");

      // Mark that remote description is set
      this.remoteDescriptionSet.set(participantId, true);
      console.log(
        `[WebRTC] Remote description set successfully for ${participantId}`
      );

      // Add any buffered ICE candidates
      const bufferedCount =
        this.pendingIceCandidates.get(participantId)?.length || 0;
      if (bufferedCount > 0) {
        console.log(
          `[WebRTC] Adding ${bufferedCount} buffered ICE candidates for ${participantId}`
        );
        await this.addBufferedIceCandidates(participantId);
      }

      // Create and send answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      this.sendMessage({
        type: "answer",
        meetingId: this.getMeetingId(),
        from: this.config.participantId,
        to: participantId,
        data: { sdp: answer },
      });

      // Update state tracking
      this.updateParticipantState(participantId, "sentAnswer");

      console.log(`[WebRTC] Answer sent to ${participantId}`);
    } catch (error) {
      console.error(
        `[WebRTC] Error in handleOfferMessage for ${participantId}:`,
        {
          error: error,
          signalingState: currentState,
          participantId: participantId,
          hasRemoteDescription: !!peerConnection.remoteDescription,
          hasLocalDescription: !!peerConnection.localDescription,
        }
      );
      this.handleWebRTCError(
        error as Error,
        participantId,
        "handleOfferMessage"
      );
    }
  }

  /**
   * Handle answer message
   */
  private async handleAnswerMessage(message: AnswerMessage): Promise<void> {
    const { from: participantId } = message;

    if (!participantId) {
      console.warn("[WebRTC] Answer message missing participant ID");
      return;
    }

    console.log(`[WebRTC] Processing answer message from ${participantId}`);

    const participant = this.participants.get(participantId);
    if (!participant || !participant.peerConnection) {
      console.warn(
        `[WebRTC] Participant ${participantId} not found for answer message`
      );
      return;
    }

    const peerConnection = participant.peerConnection;
    const currentState = peerConnection.signalingState;

    // Log detailed state information for debugging
    console.log(`[WebRTC] Answer processing details for ${participantId}:`, {
      signalingState: currentState,
      remoteDescription: !!peerConnection.remoteDescription,
      localDescription: !!peerConnection.localDescription,
      pendingIceCandidates:
        this.pendingIceCandidates.get(participantId)?.length || 0,
      remoteDescriptionSet:
        this.remoteDescriptionSet.get(participantId) || false,
    });

    // Validate state before setting remote description
    if (
      !this.validateStateForSetRemoteDescription(
        peerConnection,
        "answer",
        participantId
      )
    ) {
      console.warn(
        `[WebRTC] Invalid state for answer from ${participantId}, skipping`
      );
      return;
    }

    try {
      console.log(
        `[WebRTC] Setting remote description (answer) for ${participantId} in state: ${currentState}`
      );
      await peerConnection.setRemoteDescription(message.data.sdp);

      // Update state tracking
      this.updateParticipantState(participantId, "receivedAnswer");

      // Mark that remote description is set
      this.remoteDescriptionSet.set(participantId, true);
      console.log(
        `[WebRTC] Remote description set successfully for ${participantId}`
      );

      // Add any buffered ICE candidates
      const bufferedCount =
        this.pendingIceCandidates.get(participantId)?.length || 0;
      if (bufferedCount > 0) {
        console.log(
          `[WebRTC] Adding ${bufferedCount} buffered ICE candidates for ${participantId}`
        );
        await this.addBufferedIceCandidates(participantId);
      }
    } catch (error) {
      console.error(
        `[WebRTC] Error in handleAnswerMessage for ${participantId}:`,
        {
          error: error,
          signalingState: currentState,
          participantId: participantId,
          hasRemoteDescription: !!peerConnection.remoteDescription,
          hasLocalDescription: !!peerConnection.localDescription,
        }
      );
      this.handleWebRTCError(
        error as Error,
        participantId,
        "handleAnswerMessage"
      );
    }
  }

  /**
   * Handle ICE candidate message
   */
  private async handleIceCandidateMessage(
    message: IceCandidateMessage
  ): Promise<void> {
    const { from: participantId } = message;

    if (!participantId) {
      console.warn("[WebRTC] ICE candidate message missing participant ID");
      return;
    }

    console.log(`[WebRTC] Processing ICE candidate from ${participantId}`);

    const participant = this.participants.get(participantId);
    if (!participant || !participant.peerConnection) {
      console.warn(
        `[WebRTC] Participant ${participantId} not found for ICE candidate`
      );
      return;
    }

    const peerConnection = participant.peerConnection;
    const signalingState = peerConnection.signalingState;
    const hasRemoteDescription = !!peerConnection.remoteDescription;

    console.log(
      `[WebRTC] ICE candidate processing for ${participantId} - signaling state: ${signalingState}, has remote description: ${hasRemoteDescription}`
    );

    // Enhanced validation before adding ICE candidate
    if (hasRemoteDescription && signalingState !== "closed") {
      try {
        await peerConnection.addIceCandidate(message.data.candidate);
        console.log(
          `[WebRTC] Successfully added ICE candidate for participant ${participantId}`
        );
      } catch (error) {
        console.error(
          `[WebRTC] Failed to add ICE candidate for ${participantId}:`,
          {
            error: error,
            signalingState: signalingState,
            hasRemoteDescription: hasRemoteDescription,
            candidate: message.data.candidate,
          }
        );

        // Handle specific ICE candidate errors
        if (error instanceof Error) {
          if (error.name === "InvalidStateError") {
            console.warn(
              `[WebRTC] Invalid state for ICE candidate, buffering for retry. State: ${signalingState}`
            );
            this.bufferIceCandidate(participantId, message.data.candidate);
          } else if (error.message.includes("remote description was null")) {
            console.warn(
              `[WebRTC] Remote description became null during ICE candidate addition, buffering for retry`
            );
            this.bufferIceCandidate(participantId, message.data.candidate);
          } else {
            // For other errors, still buffer for retry
            console.warn(
              `[WebRTC] Unexpected ICE candidate error, buffering for retry: ${error.message}`
            );
            this.bufferIceCandidate(participantId, message.data.candidate);
          }
        } else {
          // For non-Error objects, still buffer for retry
          this.bufferIceCandidate(participantId, message.data.candidate);
        }
      }
    } else {
      // Buffer the ICE candidate until remote description is set and connection is not closed
      const bufferReason = !hasRemoteDescription
        ? "remote description not set"
        : "connection is closed";

      console.log(
        `[WebRTC] Buffering ICE candidate for ${participantId} - ${bufferReason} (state: ${signalingState})`
      );
      this.bufferIceCandidate(participantId, message.data.candidate);
    }
  }

  /**
   * Buffer ICE candidate for later addition
   */
  private bufferIceCandidate(
    participantId: string,
    candidate: RTCIceCandidateInit
  ): void {
    if (!this.pendingIceCandidates.has(participantId)) {
      this.pendingIceCandidates.set(participantId, []);
    }
    this.pendingIceCandidates.get(participantId)!.push(candidate);
    console.log(
      `[WebRTC] Buffered ICE candidate for ${participantId}. Total buffered: ${
        this.pendingIceCandidates.get(participantId)!.length
      }`
    );
  }

  /**
   * Add all buffered ICE candidates for a participant
   */
  private async addBufferedIceCandidates(participantId: string): Promise<void> {
    const bufferedCandidates = this.pendingIceCandidates.get(participantId);
    if (!bufferedCandidates || bufferedCandidates.length === 0) {
      return;
    }

    const participant = this.participants.get(participantId);
    if (!participant || !participant.peerConnection) {
      console.warn(
        `[WebRTC] Cannot add buffered candidates - participant ${participantId} not found`
      );
      return;
    }

    const peerConnection = participant.peerConnection;

    // Double-check that remote description is set before adding ICE candidates
    if (!peerConnection.remoteDescription) {
      console.warn(
        `[WebRTC] Remote description not set for ${participantId}, keeping ${bufferedCandidates.length} candidates buffered`
      );
      return; // Don't clear the buffer, keep candidates for later
    }

    console.log(
      `[WebRTC] Adding ${bufferedCandidates.length} buffered ICE candidates for ${participantId} (signaling state: ${peerConnection.signalingState})`
    );

    const successfulCandidates = [];
    const failedCandidates = [];

    for (const candidate of bufferedCandidates) {
      try {
        // Additional check before adding candidate
        if (peerConnection.remoteDescription) {
          await peerConnection.addIceCandidate(candidate);
          successfulCandidates.push(candidate);
        } else {
          console.warn(
            `[WebRTC] Remote description became null while adding candidates for ${participantId}, buffering remaining`
          );
          failedCandidates.push(candidate);
        }
      } catch (error) {
        console.error(
          `[WebRTC] Failed to add buffered ICE candidate for ${participantId}:`,
          error
        );
        failedCandidates.push(candidate);

        // Handle specific errors
        if (error instanceof Error && error.name === "InvalidStateError") {
          console.warn(
            `[WebRTC] Invalid state for ICE candidate addition, keeping candidate for retry`
          );
        }
      }
    }

    // Update buffer with failed candidates for retry
    if (failedCandidates.length > 0) {
      console.log(
        `[WebRTC] ${failedCandidates.length} candidates failed to add for ${participantId}, keeping them buffered`
      );
      this.pendingIceCandidates.set(participantId, failedCandidates);
    } else {
      // Clear buffered candidates only if all were successful
      this.pendingIceCandidates.delete(participantId);
      console.log(
        `[WebRTC] All ${successfulCandidates.length} buffered ICE candidates added successfully for ${participantId}`
      );
    }
  }

  /**
   * Create RTCPeerConnection with event handlers
   */
  private createPeerConnection(participantId: string): RTCPeerConnection {
    const peerConnection = new RTCPeerConnection(this.rtcConfig);

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        // Send all ICE candidates, including null candidate (signaling end)
        this.sendMessage({
          type: "ice-candidate",
          meetingId: this.getMeetingId(),
          from: this.config.participantId,
          to: participantId,
          data: { candidate: event.candidate },
        });
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      const state = this.getPeerConnectionState(peerConnection);
      const participant = this.participants.get(participantId);
      if (participant) {
        participant.connectionState = state;
      }
      this.emit("connection-state-changed", participantId, state);

      // Log TURN usage based on connection state
      this.logTURNUsage(peerConnection, participantId, state);
    };

    // Handle ICE connection state changes for detailed monitoring
    peerConnection.oniceconnectionstatechange = () => {
      console.log(
        `[WebRTC] ICE connection state for ${participantId}:`,
        peerConnection.iceConnectionState
      );
      this.emit(
        "ice-connection-state-changed",
        participantId,
        peerConnection.iceConnectionState
      );

      // Log TURN usage based on ICE connection state
      this.logTURNUsage(
        peerConnection,
        participantId,
        peerConnection.iceConnectionState
      );
    };

    // Handle remote streams
    peerConnection.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        const participant = this.participants.get(participantId);
        if (participant) {
          participant.stream = remoteStream;
        }
        this.emit("remote-stream", participantId, remoteStream);
      }
    };

    return peerConnection;
  }

  /**
   * Remove participant and cleanup their connection
   */
  private removeParticipant(participantId: string): void {
    console.log(`[WebRTC] Removing participant ${participantId}`);

    const participant = this.participants.get(participantId);
    if (participant) {
      // Close peer connection
      if (participant.peerConnection) {
        console.log(`[WebRTC] Closing peer connection for ${participantId}`);
        participant.peerConnection.close();
      }

      // Remove from participants map
      this.participants.delete(participantId);

      // Clean up all tracking data for this participant
      this.pendingIceCandidates.delete(participantId);
      this.remoteDescriptionSet.delete(participantId);
      this.participantStateTracking.delete(participantId);

      // Clean up processed messages related to this participant
      const messagesToDelete: string[] = [];
      this.processedMessages.forEach((messageId) => {
        if (messageId.includes(participantId)) {
          messagesToDelete.push(messageId);
        }
      });

      messagesToDelete.forEach((messageId) => {
        this.processedMessages.delete(messageId);
      });

      if (messagesToDelete.length > 0) {
        console.log(
          `[WebRTC] Cleaned up ${messagesToDelete.length} processed messages for ${participantId}`
        );
      }

      console.log(`[WebRTC] Participant ${participantId} removed successfully`);
    } else {
      console.warn(
        `[WebRTC] Participant ${participantId} not found for removal`
      );
    }
  }

  /**
   * Get meeting ID from WebSocket service
   */
  private getMeetingId(): string {
    // This should be extracted from the WebSocket service config
    // For now, we'll assume it's available in the config
    return (this.config.webSocketService as any).config?.meetingId || "";
  }

  /**
   * Send message through WebSocket
   */
  private sendMessage(message: any): void {
    this.config.webSocketService.send(message);
  }

  /**
   * Convert RTCPeerConnectionState to our PeerConnectionState
   */
  private getPeerConnectionState(
    peerConnection: RTCPeerConnection
  ): PeerConnectionState {
    switch (peerConnection.connectionState) {
      case "new":
        return "new";
      case "connecting":
        return "connecting";
      case "connected":
        return "connected";
      case "disconnected":
        return "disconnected";
      case "failed":
        return "failed";
      case "closed":
        return "closed";
      default:
        return "new";
    }
  }

  /**
   * Emit event to all listeners
   */
  private emit<K extends keyof WebRTCManagerEvents>(
    event: K,
    ...args: Parameters<WebRTCManagerEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(...args);
        } catch (error) {
          console.error(
            `Error in WebRTC event listener for ${String(event)}:`,
            error
          );
        }
      });
    }
  }

  /**
   * Setup message cleanup interval to prevent memory leaks
   */
  private setupMessageCleanup(): void {
    // Clean up processed messages every 5 minutes
    this.messageCleanupInterval = setInterval(() => {
      if (this.processedMessages.size > 1000) {
        console.log(
          `[WebRTC] Cleaning up ${this.processedMessages.size} processed messages`
        );
        this.processedMessages.clear();
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Generate unique message ID for deduplication
   */
  private generateMessageId(message: SignalingMessage): string {
    const baseId = `${message.type}_${message.from}_${
      message.to || "broadcast"
    }_${Date.now()}`;

    // For offer/answer messages, include SDP hash for better deduplication
    if (isOfferMessage(message) || isAnswerMessage(message)) {
      const sdpHash = this.hashString(JSON.stringify(message.data.sdp));
      return `${baseId}_${sdpHash}`;
    }

    return baseId;
  }

  /**
   * Check if message has been processed
   */
  private isMessageProcessed(messageId: string): boolean {
    if (this.processedMessages.has(messageId)) {
      console.warn(`[WebRTC] Duplicate message detected: ${messageId}`);
      return true;
    }
    this.processedMessages.add(messageId);
    return false;
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Determine signaling role based on participant IDs
   */
  private determineSignalingRole(participantId: string): boolean {
    // The participant with lexicographically smaller ID becomes the offerer
    return this.config.participantId < participantId;
  }

  /**
   * Initialize state tracking for a participant
   */
  private initializeParticipantStateTracking(participantId: string): void {
    if (!this.participantStateTracking.has(participantId)) {
      const isOfferer = this.determineSignalingRole(participantId);
      this.participantStateTracking.set(participantId, {
        hasSentOffer: false,
        hasReceivedOffer: false,
        hasSentAnswer: false,
        hasReceivedAnswer: false,
        isOfferer: isOfferer,
      });

      console.log(
        `[WebRTC] Initialized state tracking for ${participantId}. Role: ${
          isOfferer ? "offerer" : "answerer"
        }`
      );
    }
  }

  /**
   * Update participant state tracking
   */
  private updateParticipantState(
    participantId: string,
    action: "sentOffer" | "receivedOffer" | "sentAnswer" | "receivedAnswer"
  ): void {
    const tracking = this.participantStateTracking.get(participantId);
    if (tracking) {
      switch (action) {
        case "sentOffer":
          tracking.hasSentOffer = true;
          break;
        case "receivedOffer":
          tracking.hasReceivedOffer = true;
          break;
        case "sentAnswer":
          tracking.hasSentAnswer = true;
          break;
        case "receivedAnswer":
          tracking.hasReceivedAnswer = true;
          break;
      }

      console.log(
        `[WebRTC] Updated state for ${participantId}: ${action}. Current state:`,
        {
          hasSentOffer: tracking.hasSentOffer,
          hasReceivedOffer: tracking.hasReceivedOffer,
          hasSentAnswer: tracking.hasSentAnswer,
          hasReceivedAnswer: tracking.hasReceivedAnswer,
          isOfferer: tracking.isOfferer,
        }
      );
    }
  }

  /**
   * Validate peer connection state before setting remote description
   */
  private validateStateForSetRemoteDescription(
    peerConnection: RTCPeerConnection,
    messageType: string,
    participantId: string
  ): boolean {
    const currentState = peerConnection.signalingState;
    const tracking = this.participantStateTracking.get(participantId);

    console.log(
      `[WebRTC] Validating state for ${messageType} from ${participantId}. Current state: ${currentState}`
    );

    // Log participant tracking info for debugging
    if (tracking) {
      console.log(`[WebRTC] Participant ${participantId} tracking:`, {
        hasSentOffer: tracking.hasSentOffer,
        hasReceivedOffer: tracking.hasReceivedOffer,
        hasSentAnswer: tracking.hasSentAnswer,
        hasReceivedAnswer: tracking.hasReceivedAnswer,
        isOfferer: tracking.isOfferer,
      });
    }

    let validStates: string[] = [];

    switch (messageType) {
      case "offer":
        // For offer: only allow "stable" state
        validStates = ["stable"];
        break;
      case "answer":
        // For answer: only allow "have-local-offer" state
        validStates = ["have-local-offer"];
        break;
      default:
        // For other message types, allow both states
        validStates = ["stable", "have-local-offer"];
        break;
    }

    if (!validStates.includes(currentState)) {
      console.warn(
        `[WebRTC] Invalid state for ${messageType}: ${currentState} from ${participantId}. ` +
          `Expected one of: ${validStates.join(", ")}`
      );
      return false;
    }

    console.log(
      `[WebRTC] State validation passed for ${messageType} from ${participantId} (state: ${currentState})`
    );
    return true;
  }

  /**
   * Reset peer connection for recovery
   */
  private async resetPeerConnection(participantId: string): Promise<void> {
    console.log(`[WebRTC] Resetting peer connection for ${participantId}`);

    const participant = this.participants.get(participantId);
    if (!participant) {
      console.warn(
        `[WebRTC] Cannot reset connection - participant ${participantId} not found`
      );
      return;
    }

    // Close old connection
    if (participant.peerConnection) {
      participant.peerConnection.close();
    }

    // Clean up state
    this.pendingIceCandidates.delete(participantId);
    this.remoteDescriptionSet.delete(participantId);

    // Reset participant state tracking but preserve role
    const tracking = this.participantStateTracking.get(participantId);
    if (tracking) {
      const isOfferer = tracking.isOfferer;
      this.participantStateTracking.set(participantId, {
        hasSentOffer: false,
        hasReceivedOffer: false,
        hasSentAnswer: false,
        hasReceivedAnswer: false,
        isOfferer: isOfferer,
      });
      console.log(
        `[WebRTC] Reset state tracking for ${participantId}. Role preserved: ${
          isOfferer ? "offerer" : "answerer"
        }`
      );
    }

    // Create new peer connection
    const newPeerConnection = this.createPeerConnection(participantId);

    // Add local tracks
    this.config.localStream.getTracks().forEach((track) => {
      newPeerConnection.addTrack(track, this.config.localStream);
    });

    // Update participant
    participant.peerConnection = newPeerConnection;
    participant.connectionState =
      this.getPeerConnectionState(newPeerConnection);
    participant.stream = undefined; // Clear remote stream

    console.log(
      `[WebRTC] Peer connection reset completed for ${participantId}`
    );
    // Note: connection-reset event should be added to WebRTCManagerEvents type if needed
    // this.emit("connection-reset", participantId);
  }

  /**
   * Handle WebRTC errors with specific recovery strategies
   */
  private handleWebRTCError(
    error: Error,
    participantId: string,
    context: string
  ): void {
    console.error(`[WebRTC] Error in ${context} for ${participantId}:`, error);

    // Handle InvalidStateError specifically
    if (
      error.name === "InvalidStateError" ||
      error.message.includes("InvalidStateError")
    ) {
      console.warn(
        `[WebRTC] Invalid state detected for ${participantId}, attempting reset`
      );
      this.resetPeerConnection(participantId);
      return;
    }

    // Handle other critical errors
    if (
      error.name === "OperationError" ||
      error.message.includes("setRemoteDescription")
    ) {
      console.warn(
        `[WebRTC] Critical signaling error for ${participantId}, attempting reset`
      );
      this.resetPeerConnection(participantId);
      return;
    }

    // Emit general error for other cases
    this.emit("error", error);
  }

  /**
   * Initialize ICE servers with TURN support
   */
  private async initializeICEServers(): Promise<void> {
    try {
      console.log("[WebRTC] Initializing ICE servers with TURN support...");

      // Get ICE servers from TURN manager
      const iceServers = await iceServerManager.getIceServers(
        this.config.participantId,
        this.getMeetingId()
      );

      // Update RTC configuration with enhanced ICE servers
      this.rtcConfig.iceServers = iceServers;

      console.log("[WebRTC] ICE servers initialized successfully:", {
        totalServers: iceServers.length,
        stunServers: iceServers.filter((s) => !s.username).length,
        turnServers: iceServers.filter((s) => s.username).length,
      });

      // Test connectivity if needed
      if (this.config.testConnectivity) {
        this.testConnectivity();
      }
    } catch (error) {
      console.error("[WebRTC] Failed to initialize ICE servers:", error);
      // Continue with basic STUN servers as fallback
      this.emit("ice-servers-error", error);
    }
  }

  /**
   * Test TURN connectivity
   */
  private async testConnectivity(): Promise<void> {
    try {
      console.log("[WebRTC] Testing TURN connectivity...");
      const result = await iceServerManager.testConnectivity(
        this.config.participantId,
        this.getMeetingId()
      );

      console.log("[WebRTC] TURN connectivity test result:", result);
      this.emit("connectivity-test-result", result);

      if (!result.success) {
        console.warn("[WebRTC] TURN connectivity test failed:", result.error);
      }
    } catch (error) {
      console.error("[WebRTC] TURN connectivity test error:", error);
      this.emit("connectivity-test-error", error);
    }
  }

  /**
   * Log TURN usage for analytics
   */
  private logTURNUsage(
    peerConnection: RTCPeerConnection,
    participantId: string,
    state: string
  ): void {
    // Only log if we have TURN credentials
    const credentials = (iceServerManager as any).credentials;
    if (!credentials) return;

    try {
      switch (state) {
        case "connected":
        case "completed":
          iceServerManager.logUsage(credentials.username, "connect");
          break;
        case "disconnected":
        case "failed":
        case "closed":
          iceServerManager.logUsage(credentials.username, "disconnect");
          break;
      }
    } catch (error) {
      console.error("[WebRTC] Failed to log TURN usage:", error);
    }
  }

  /**
   * Get TURN server information
   */
  async getTurnServerInfo(): Promise<any> {
    try {
      return await iceServerManager.getServerInfo();
    } catch (error) {
      console.error("[WebRTC] Failed to get TURN server info:", error);
      throw error;
    }
  }

  /**
   * Refresh TURN credentials
   */
  async refreshTurnCredentials(): Promise<void> {
    try {
      console.log("[WebRTC] Refreshing TURN credentials...");
      await this.initializeICEServers();

      // Update existing peer connections with new ICE servers
      this.participants.forEach((participant) => {
        if (participant.peerConnection) {
          // Note: RTCPeerConnection doesn't support updating iceServers after creation
          // This would require recreating connections, which is handled by reconnection logic
          console.log(
            `[WebRTC] TURN credentials refreshed for ${participant.id} (will apply to new connections)`
          );
        }
      });

      this.emit("turn-credentials-refreshed");
    } catch (error) {
      console.error("[WebRTC] Failed to refresh TURN credentials:", error);
      this.emit("turn-credentials-error", error);
    }
  }
}

/**
 * Create WebRTC manager instance
 */
export function createWebRTCManager(
  config: WebRTCManagerConfig
): WebRTCManager {
  return new WebRTCManager(config);
}
