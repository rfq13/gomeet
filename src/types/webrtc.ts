// WebSocket Message Types
export type WebSocketMessageType =
  | "offer"
  | "answer"
  | "ice-candidate"
  | "join"
  | "leave"
  | "participant-joined"
  | "participant-left";

// Base WebSocket Message Interface
export interface WebSocketMessage {
  type: WebSocketMessageType;
  meetingId: string;
  from: string;
  to?: string;
  data: any;
  timestamp: string;
}

// Specific Message Types
export interface OfferMessage extends WebSocketMessage {
  type: "offer";
  data: {
    sdp: RTCSessionDescriptionInit;
  };
}

export interface AnswerMessage extends WebSocketMessage {
  type: "answer";
  data: {
    sdp: RTCSessionDescriptionInit;
  };
}

export interface IceCandidateMessage extends WebSocketMessage {
  type: "ice-candidate";
  data: {
    candidate: RTCIceCandidateInit;
  };
}

export interface JoinMessage extends WebSocketMessage {
  type: "join";
  data: {
    participantId: string;
    participantName: string;
  };
}

export interface LeaveMessage extends WebSocketMessage {
  type: "leave";
  data: {
    participantId: string;
  };
}

export interface ParticipantJoinedMessage extends WebSocketMessage {
  type: "participant-joined";
  data: {
    participantId: string;
    participantName: string;
  };
}

export interface ParticipantLeftMessage extends WebSocketMessage {
  type: "participant-left";
  data: {
    participantId: string;
  };
}

// Union type for all WebSocket messages
export type SignalingMessage =
  | OfferMessage
  | AnswerMessage
  | IceCandidateMessage
  | JoinMessage
  | LeaveMessage
  | ParticipantJoinedMessage
  | ParticipantLeftMessage;

// WebSocket Connection States
export type WebSocketState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"
  | "reconnecting";

// WebSocket Configuration
export interface WebSocketConfig {
  url: string;
  meetingId: string;
  token?: string;
  sessionId?: string;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
}

// WebRTC Peer Connection States
export type PeerConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

// Participant Information
export interface Participant {
  id: string;
  name: string;
  stream?: MediaStream;
  peerConnection?: RTCPeerConnection;
  connectionState?: PeerConnectionState;
}

// WebRTC Configuration
export interface WebRTCConfig {
  iceServers: RTCIceServer[];
  iceCandidatePoolSize?: number;
}

// WebRTC Manager Events
export interface WebRTCManagerEvents {
  "participant-joined": (participant: Participant) => void;
  "participant-left": (participantId: string) => void;
  "remote-stream": (participantId: string, stream: MediaStream) => void;
  "connection-state-changed": (
    participantId: string,
    state: PeerConnectionState
  ) => void;
  "ice-connection-state-changed": (
    participantId: string,
    state: RTCIceConnectionState
  ) => void;
  "chat-message": (message: any) => void;
  "ice-servers-error": (error: Error) => void;
  "connectivity-test-result": (result: any) => void;
  "connectivity-test-error": (error: Error) => void;
  "turn-credentials-refreshed": () => void;
  "turn-credentials-error": (error: Error) => void;
  error: (error: Error) => void;
}

// WebSocket Service Events
export interface WebSocketServiceEvents {
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
  message: (message: SignalingMessage) => void;
  reconnecting: (attempt: number) => void;
}

// WebRTC Manager Configuration
export interface WebRTCManagerConfig {
  localStream: MediaStream;
  participantId: string;
  participantName: string;
  webSocketService: any; // Use any to avoid circular dependency, will be properly typed in implementation
  rtcConfig?: WebRTCConfig;
  testConnectivity?: boolean;
}

// Type guard functions
export function isOfferMessage(
  message: WebSocketMessage
): message is OfferMessage {
  return message.type === "offer";
}

export function isAnswerMessage(
  message: WebSocketMessage
): message is AnswerMessage {
  return message.type === "answer";
}

export function isIceCandidateMessage(
  message: WebSocketMessage
): message is IceCandidateMessage {
  return message.type === "ice-candidate";
}

export function isJoinMessage(
  message: WebSocketMessage
): message is JoinMessage {
  return message.type === "join";
}

export function isLeaveMessage(
  message: WebSocketMessage
): message is LeaveMessage {
  return message.type === "leave";
}

export function isParticipantJoinedMessage(
  message: WebSocketMessage
): message is ParticipantJoinedMessage {
  return message.type === "participant-joined";
}

export function isParticipantLeftMessage(
  message: WebSocketMessage
): message is ParticipantLeftMessage {
  return message.type === "participant-left";
}
