// WebRTC Service untuk handling peer-to-peer connections
import {
  createWebSocketClient,
  type WebSocketClient,
} from "./websocket-client";
import type { SignalingMessage, JoinPayload, LeavePayload } from "$types";

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
}

export class WebRTCService {
  private options: WebRTCServiceOptions;
  private wsClient: WebSocketClient;
  private peers: Map<string, PeerConnection> = new Map();
  private localPeerId: string | null = null;
  private isDestroyed = false;

  // ICE servers configuration
  private iceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ];

  constructor(options: WebRTCServiceOptions) {
    this.options = options;

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

  async connect(): Promise<void> {
    try {
      await this.wsClient.connect();
      // Set local peer ID from WebSocket client
      this.localPeerId = this.wsClient.getClientId();
      console.log("[WebRTC] Local peer ID set:", this.localPeerId);
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
    console.log("[WebRTC] Current peers before handling join:", Array.from(this.peers.keys()));
    console.log("[WebRTC] Current peers count:", this.peers.size);

    // Enhanced handling for Anonymous User detection
    if (payload.name === "Anonymous User") {
      console.warn("[WebRTC] WARNING: Received 'Anonymous User' - this indicates backend identification issue");
      console.warn("[WebRTC] Participant details:", {
        participantId: payload.participantId,
        name: payload.name,
        isAuthenticated: payload.isAuthenticated
      });
      
      // Optional: Implement retry mechanism for user info refresh
      this.scheduleUserInfoRefresh(payload.participantId);
    }

    // Check if we already have an emergency connection for this peer
    const existingPeer = this.peers.get(payload.participantId);
    if (existingPeer) {
      console.log("[WebRTC] FOUND EXISTING PEER - Updating existing peer connection with participant info:", payload.participantId);
      console.log("[WebRTC] Existing peer details:", {
        id: existingPeer.id,
        name: existingPeer.name,
        isAuthenticated: existingPeer.isAuthenticated,
        isEmergency: existingPeer.isEmergency,
        signalingState: existingPeer.connection.signalingState,
        connectionState: existingPeer.connection.connectionState
      });
      
      // If this is an emergency connection, we need to handle the transition properly
      if (existingPeer.isEmergency) {
        console.log("[WebRTC] TRANSITIONING EMERGENCY CONNECTION TO NORMAL for:", payload.participantId);
        
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
          signalingState: existingPeer.connection.signalingState
        });
        
        // If the connection is in stable state, we might need to recreate it
        // to ensure proper WebRTC signaling flow
        if (existingPeer.connection.signalingState === "stable") {
          console.log("[WebRTC] Emergency connection is in stable state, recreating connection for:", payload.participantId);
          this.recreatePeerConnection(payload.participantId, payload.name, payload.isAuthenticated);
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
          newAuth: payload.isAuthenticated
        });
      }
      
      this.options.onPeerJoined?.(existingPeer);
    } else {
      console.log("[WebRTC] NO EXISTING PEER - Creating new peer connection for participant:", payload.participantId);
      // Create new peer connection for new participant
      this.createPeerConnection(
        payload.participantId,
        payload.name,
        payload.isAuthenticated
      );
    }
    
    console.log("[WebRTC] Current peers after handling join:", Array.from(this.peers.keys()));
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
    console.log("[WebRTC] Current peers before creating:", Array.from(this.peers.keys()));
    console.log("[WebRTC] Current peers count:", this.peers.size);
    
    if (this.peers.has(peerId)) {
      console.log("[WebRTC] Peer connection already exists for:", peerId);
      const existingPeer = this.peers.get(peerId);
      console.log("[WebRTC] Existing peer details:", {
        id: existingPeer?.id,
        name: existingPeer?.name,
        isAuthenticated: existingPeer?.isAuthenticated,
        signalingState: existingPeer?.connection.signalingState,
        connectionState: existingPeer?.connection.connectionState
      });
      return;
    }

    console.log("[WebRTC] CREATING NORMAL PEER CONNECTION for:", peerId);
    console.log("[WebRTC] Peer info:", { name, isAuthenticated });

    // Create RTCPeerConnection
    const configuration: RTCConfiguration = {
      iceServers: this.iceServers,
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
    console.log("[WebRTC] Peer connection stored. Current peers:", Array.from(this.peers.keys()));
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
        lastActivity: oldPeer.lastActivity
      });
    }
    
    // Remove the old connection first
    this.removePeerConnection(peerId);
    
    // Wait a bit to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
    
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
      console.log("[WebRTC] Connection state before createOffer:", peer.connection.signalingState);
      const offer = await peer.connection.createOffer();
      console.log("[WebRTC] Connection state after createOffer:", peer.connection.signalingState);
      
      // Store the offer for duplicate detection and state tracking
      peer.lastOffer = offer;
      
      console.log("[WebRTC] Setting local description for:", peerId);
      console.log("[WebRTC] Connection state before setLocalDescription:", peer.connection.signalingState);
      await peer.connection.setLocalDescription(offer);
      console.log("[WebRTC] Connection state after setLocalDescription:", peer.connection.signalingState);

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
        sdp: offer.sdp?.substring(0, 100) + "..."
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
        hasLastOffer: !!peer.lastOffer
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
      console.log("[WebRTC] Connection state before setRemoteDescription:", currentState);
      
      // If connection is in stable state, we might need to handle it differently
      if (currentState === "stable") {
        console.log("[WebRTC] Connection is in stable state, checking if we need to recreate:", fromPeerId);
        
        // For emergency connections in stable state, recreate to ensure proper flow
        if (peer.isEmergency) {
          console.log("[WebRTC] Recreating emergency connection in stable state:", fromPeerId);
          await this.recreatePeerConnection(fromPeerId, peer.name, peer.isAuthenticated);
          // After recreation, we need to handle the offer again with the new connection
          console.log("[WebRTC] Re-handling offer after recreation:", fromPeerId);
          await this.handleOffer(fromPeerId, offer);
          return;
        }
        
        // For normal connections, we can proceed but might need to renegotiate
        console.log("[WebRTC] Normal connection in stable state, proceeding with offer:", fromPeerId);
      }
      
      // Additional state validation for other problematic states
      const problematicStates = ["closed", "failed", "disconnected"];
      if (problematicStates.includes(currentState)) {
        console.log("[WebRTC] Connection is in problematic state, recreating:", fromPeerId, currentState);
        await this.recreatePeerConnection(fromPeerId, peer.name, peer.isAuthenticated);
        // After recreation, we need to handle the offer again with the new connection
        console.log("[WebRTC] Re-handling offer after recreation due to problematic state:", fromPeerId);
        await this.handleOffer(fromPeerId, offer);
        return;
      }
      
      console.log("[WebRTC] Setting remote description for:", fromPeerId);
      await peer.connection.setRemoteDescription(
        new RTCSessionDescription(offer)
      );
      
      console.log("[WebRTC] Connection state after setRemoteDescription:", peer.connection.signalingState);

      // Create and send answer
      console.log("[WebRTC] Creating answer for:", fromPeerId);
      const answer = await peer.connection.createAnswer();
      console.log("[WebRTC] Connection state after createAnswer:", peer.connection.signalingState);
      
      console.log("[WebRTC] Setting local description for:", fromPeerId);
      await peer.connection.setLocalDescription(answer);
      console.log("[WebRTC] Connection state after setLocalDescription:", peer.connection.signalingState);

      console.log("[WebRTC] Sending answer to:", fromPeerId);
      this.wsClient.sendAnswer(fromPeerId, answer);
      
      console.log("[WebRTC] Offer handling completed successfully for:", fromPeerId);
    } catch (error) {
      console.error("[WebRTC] Error handling offer:", error);
      
      // Enhanced error reporting
      if (error instanceof Error) {
        console.error("[WebRTC] Error details:", {
          name: error.name,
          message: error.message,
          stack: error.stack
        });
      }
      
      this.options.onError?.(error as Error);
    }
  }

  private async createPeerConnectionForUnknownPeer(
    peerId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<void> {
    console.log("[WebRTC] createPeerConnectionForUnknownPeer called for:", peerId);
    console.log("[WebRTC] Current peers before creating emergency connection:", Array.from(this.peers.keys()));
    console.log("[WebRTC] Current peers count:", this.peers.size);
    console.log("[WebRTC] Offer details:", {
      type: offer.type,
      sdp: offer.sdp?.substring(0, 100) + "..."
    });
    
    if (this.peers.has(peerId)) {
      console.log("[WebRTC] Peer connection already exists for unknown peer:", peerId);
      const existingPeer = this.peers.get(peerId);
      console.log("[WebRTC] Existing peer details:", {
        id: existingPeer?.id,
        name: existingPeer?.name,
        isAuthenticated: existingPeer?.isAuthenticated,
        isEmergency: existingPeer?.isEmergency,
        signalingState: existingPeer?.connection.signalingState,
        connectionState: existingPeer?.connection.connectionState,
        createdAt: existingPeer?.createdAt,
        lastActivity: existingPeer?.lastActivity
      });
      
      // If existing connection is also emergency, we might need to recreate it
      if (existingPeer?.isEmergency) {
        console.log("[WebRTC] Emergency connection already exists, recreating for unknown peer:", peerId);
        await this.recreatePeerConnection(peerId, existingPeer.name, existingPeer.isAuthenticated);
        // Handle the offer with the new connection
        const newPeer = this.peers.get(peerId);
        if (newPeer) {
          await newPeer.connection.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await newPeer.connection.createAnswer();
          await newPeer.connection.setLocalDescription(answer);
          this.wsClient.sendAnswer(peerId, answer);
        }
      }
      return;
    }

    console.log("[WebRTC] CREATING EMERGENCY PEER CONNECTION for unknown peer:", peerId);
    console.warn("[WebRTC] WARNING: Emergency connection created for unknown peer - this may indicate backend user identification issues");

    // Create RTCPeerConnection
    const configuration: RTCConfiguration = {
      iceServers: this.iceServers,
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
        console.log("[WebRTC] Emergency connection failed/closed, removing:", peerId);
        this.removePeerConnection(peerId);
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
    
    console.log("[WebRTC] Emergency peer connection created, notifying callback");
    this.options.onPeerJoined?.(peerConnectionInfo);

    try {
      // Set remote description from the received offer
      console.log("[WebRTC] Setting remote description from offer for unknown peer:", peerId);
      console.log("[WebRTC] Connection state before setRemoteDescription:", peerConnection.signalingState);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      console.log("[WebRTC] Connection state after setRemoteDescription:", peerConnection.signalingState);

      // Create and send answer
      console.log("[WebRTC] Creating answer for unknown peer:", peerId);
      const answer = await peerConnection.createAnswer();
      console.log("[WebRTC] Setting local description for unknown peer:", peerId);
      console.log("[WebRTC] Connection state before setLocalDescription:", peerConnection.signalingState);
      await peerConnection.setLocalDescription(answer);
      console.log("[WebRTC] Connection state after setLocalDescription:", peerConnection.signalingState);

      console.log("[WebRTC] Sending answer to unknown peer:", peerId);
      this.wsClient.sendAnswer(peerId, answer);
      
      console.log("[WebRTC] Emergency connection setup completed for:", peerId);
    } catch (error) {
      console.error("[WebRTC] Error setting up emergency connection for:", peerId, error);
      
      // Clean up on error
      this.removePeerConnection(peerId);
      
      // Enhanced error reporting
      if (error instanceof Error) {
        console.error("[WebRTC] Emergency connection error details:", {
          name: error.name,
          message: error.message,
          stack: error.stack
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
      console.log("[WebRTC] Peer connection state:", peer.connection.signalingState);
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
          "Expected one of:", validStates
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
          hasLastOffer: !!peer.lastOffer
        });
        
        // Enhanced auto-recovery for emergency connections
        if (peer.isEmergency) {
          console.log("[WebRTC] Attempting to recover emergency connection by recreating it:", fromPeerId);
          try {
            await this.recreatePeerConnection(fromPeerId, peer.name, peer.isAuthenticated);
            console.log("[WebRTC] Emergency connection recovery completed for:", fromPeerId);
            return;
          } catch (recoveryError) {
            console.error("[WebRTC] Failed to recover emergency connection:", recoveryError);
          }
        }
        
        // For normal connections, try to recreate as last resort
        console.log("[WebRTC] Attempting to recover normal connection by recreating it:", fromPeerId);
        try {
          await this.recreatePeerConnection(fromPeerId, peer.name, peer.isAuthenticated);
          console.log("[WebRTC] Normal connection recovery completed for:", fromPeerId);
          return;
        } catch (recoveryError) {
          console.error("[WebRTC] Failed to recover normal connection:", recoveryError);
        }
        
        throw new Error(`Cannot set remote description in state: ${currentState}. Recovery failed.`);
      }

      console.log("[WebRTC] Setting remote description for:", fromPeerId);
      console.log("[WebRTC] Answer details:", {
        type: answer.type,
        sdp: answer.sdp?.substring(0, 100) + "..."
      });
      
      await peer.connection.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
      
      console.log("[WebRTC] Successfully set remote description. New state:", peer.connection.signalingState);
      
      // Clear last offer after successful answer processing
      peer.lastOffer = undefined;
      
    } catch (error) {
      console.error("[WebRTC] Error handling answer:", error);
      
      // Enhanced error reporting
      if (error instanceof Error) {
        console.error("[WebRTC] Error details:", {
          name: error.name,
          message: error.message,
          stack: error.stack
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
    console.log("[WebRTC] Current peers before removal:", Array.from(this.peers.keys()));
    
    const peer = this.peers.get(peerId);
    if (peer) {
      console.log("[WebRTC] REMOVING PEER CONNECTION:", peerId);
      console.log("[WebRTC] Peer details before removal:", {
        id: peer.id,
        name: peer.name,
        isAuthenticated: peer.isAuthenticated,
        signalingState: peer.connection.signalingState,
        connectionState: peer.connection.connectionState
      });

      // Close the peer connection
      peer.connection.close();

      // Remove from peers map
      this.peers.delete(peerId);
      
      console.log("[WebRTC] Peer connection removed. Current peers after removal:", Array.from(this.peers.keys()));

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
    console.log("[WebRTC] Scheduling user info refresh for participant:", participantId);
    
    // Retry mechanism: attempt to refresh user info after a delay
    setTimeout(() => {
      const peer = this.peers.get(participantId);
      if (peer && peer.name === "Anonymous User") {
        console.log("[WebRTC] Retrying user info refresh for:", participantId);
        // In a real implementation, you might want to:
        // 1. Request updated user info from backend
        // 2. Refresh participant list
        // 3. Update the peer information
        console.warn("[WebRTC] User info refresh retry completed - still Anonymous User");
      }
    }, 3000); // Retry after 3 seconds
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

  destroy(): void {
    if (this.isDestroyed) return;

    this.isDestroyed = true;
    console.log("[WebRTC] Destroying WebRTC service");

    // Close all peer connections
    this.peers.forEach((peer, peerId) => {
      this.removePeerConnection(peerId);
    });

    // Destroy WebSocket client
    this.wsClient.destroy();

    // Clear peers
    this.peers.clear();
  }
}

// Factory function untuk membuat WebRTC service
export function createWebRTCService(
  options: WebRTCServiceOptions
): WebRTCService {
  return new WebRTCService(options);
}
