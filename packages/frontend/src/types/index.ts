// User types
export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

// Meeting types
export interface Participant {
  name: string;
  id: string;
  userId: string;
  joinedAt: string;
  leftAt?: string;
  isActive: boolean;
}

export interface Meeting {
  id: string;
  title: string;
  description?: string;
  hostId: string;
  hostName: string;
  startTime: string;
  duration: number;
  meetingLink: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  participants?: Participant[];
}

export interface CreateMeetingRequest {
  name: string;
  description?: string;
  startTime: string;
  duration: number;
}

export interface UpdateMeetingRequest {
  title?: string;
  description?: string;
  startTime?: string;
  duration?: number;
}

export interface MeetingListResponse {
  meetings: Meeting[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface MeetingParams {
  page?: number;
  limit?: number;
  search?: string;
}

// Auth types
export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

// Chat types
export interface ChatMessage {
  id: string;
  meetingId: string;
  userId?: string;
  publicUserId?: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  isEdited?: boolean;
  isDeleted?: boolean;
  reactions?: ChatReaction[];
  replyToId?: string;
}

export interface ChatReaction {
  id: string;
  messageId: string;
  reaction: string;
  userId?: string;
  publicUserId?: string;
  createdAt: string;
  count?: number;
}

export interface TypingUser {
  id: string;
  name: string;
  isTyping: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  typingUsers: TypingUser[];
  pagination: PaginationInfo | null;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface UseChatOptions {
  meetingId: string;
  userId?: string;
  publicUserId?: string;
}

export interface UseChatReturn {
  // State
  messages: ChatMessage[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  typingUsers: TypingUser[];
  isConnected: boolean;

  // Actions
  sendMessage: (content: string, replyToId?: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  markAsRead: () => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  toggleTyping: () => void;
  addReaction: (messageId: string, reaction: string) => Promise<void>;
  removeReaction: (messageId: string, reaction: string) => Promise<void>;
  reconnect: () => Promise<void>;

  // Method to handle WebSocket messages from external source
  handleWebSocketMessage: (message: any) => void;
}

// WebRTC types
export interface WebRTCParticipant {
  id: string;
  name: string;
  userId: string;
  peerConnection?: RTCPeerConnection;
  mediaStream?: MediaStream;
  isSpeaking: boolean;
}

export interface WebRTCConfig {
  iceServers: RTCIceServer[];
  iceCandidatePoolSize?: number;
}

export interface WebRTCManagerOptions {
  localStream: MediaStream;
  participantId: string;
  participantName: string;
  webSocketService: any;
  rtcConfig: WebRTCConfig;
}

// WebSocket signaling types
export type SignalingMessageType =
  | "offer"
  | "answer"
  | "ice-candidate"
  | "join"
  | "leave"
  | "participant-joined"
  | "participant-left"
  | "chat-message"
  | "chat-message-edit"
  | "chat-message-delete"
  | "chat-reaction"
  | "chat-read-status"
  | "chat-typing"
  | "chat-typing-stop";

export interface SignalingMessage {
  type: SignalingMessageType;
  meetingId: string;
  from: string;
  to: string;
  data: any;
  timestamp: Date;
}

export interface JoinPayload {
  participantId: string;
  name: string;
  avatarUrl?: string;
  isAuthenticated: boolean;
}

export interface LeavePayload {
  participantId: string;
}

export interface OfferAnswerPayload {
  sdp: string;
}

export interface ICECandidatePayload {
  candidate: string;
  sdpMLineIndex: number;
  sdpMid: string;
}

export interface ChatMessagePayload {
  messageId: string;
  meetingId: string;
  userId?: string;
  publicUserId?: string;
  messageType: "text" | "image" | "file";
  content: string;
  replyToId?: string;
  attachmentUrl?: string;
  attachmentType?: string;
  attachmentName?: string;
  isEdited: boolean;
  editedAt?: string;
  isDeleted: boolean;
  deletedAt?: string;
  messageStatus: "sent" | "delivered" | "read";
  createdAt: string;
  user?: User;
  publicUser?: PublicUser;
}

export interface ChatReactionPayload {
  messageId: string;
  userId?: string;
  publicUserId?: string;
  reaction: string;
  action: "add" | "remove";
  createdAt: string;
  user?: User;
  publicUser?: PublicUser;
}

export interface ChatReadStatusPayload {
  messageId: string;
  userId?: string;
  publicUserId?: string;
  readAt: string;
}

export interface ChatTypingPayload {
  userId?: string;
  publicUserId?: string;
  userName: string;
  isTyping: boolean;
}

// Public User types
export interface PublicUser {
  id: string;
  name: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicUserResponse {
  id: string;
  name: string;
  sessionId: string;
  createdAt: string;
}

export interface CreatePublicUserRequest {
  name: string;
  sessionId: string;
}

export interface JoinMeetingAsPublicUserRequest {
  sessionId: string;
  meetingId: string;
}

export interface LeaveMeetingAsPublicUserRequest {
  sessionId: string;
  meetingId: string;
}

export interface UserResponse {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

// API types
export interface APIResponse<T = any> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

export interface APIError {
  code: string;
  message: string;
  details?: string;
}

// Store types
export interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
}

// Utility types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
