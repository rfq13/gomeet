// Import WebSocketMessage from webrtc.ts to avoid circular dependencies
import type { WebSocketMessage } from "./webrtc";

// Chat Message Types
export type MessageType = "text" | "image" | "file" | "system" | "reaction";
export type MessageStatus = "sent" | "delivered" | "read" | "failed";

// Extended WebSocket Message Types for Chat
export type ChatWebSocketMessageType =
  | "chat-message"
  | "chat-message-edit"
  | "chat-message-delete"
  | "chat-reaction"
  | "chat-read-status"
  | "chat-typing"
  | "chat-typing-stop";

// Base Chat WebSocket Message Interface
export interface ChatWebSocketMessage {
  type: ChatWebSocketMessageType;
  meetingId: string;
  from: string;
  to?: string;
  data: any;
  timestamp: string;
}

// User and Public User types (simplified for now, can be extended)
export interface User {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
}

export interface PublicUser {
  id: string;
  name: string;
  sessionId: string;
  avatar?: string;
}

// Chat Message interfaces
export interface ChatMessage {
  id: string;
  meetingId: string;
  userId?: string;
  publicUserId?: string;
  messageType: MessageType;
  content: string;
  replyToId?: string;
  attachmentUrl?: string;
  attachmentType?: string;
  attachmentName?: string;
  isEdited: boolean;
  editedAt?: string;
  isDeleted: boolean;
  deletedAt?: string;
  messageStatus: MessageStatus;
  createdAt: string;
  updatedAt: string;

  // Included relationships
  user?: User;
  publicUser?: PublicUser;
  replyTo?: ChatMessage;
  replies?: ChatMessage[];
  readStatus?: ChatMessageReadStatus[];
  reactions?: ChatMessageReaction[];
}

export interface ChatMessageReadStatus {
  id: string;
  messageId: string;
  userId?: string;
  publicUserId?: string;
  readAt: string;
  user?: User;
  publicUser?: PublicUser;
}

export interface ChatMessageReaction {
  id: string;
  messageId: string;
  userId?: string;
  publicUserId?: string;
  reaction: string;
  count: number;
  createdAt: string;
  user?: User;
  publicUser?: PublicUser;
}

// API Request/Response types
export interface CreateChatMessageRequest {
  meetingId: string;
  messageType: MessageType;
  content: string;
  replyToId?: string;
  attachmentUrl?: string;
  attachmentType?: string;
  attachmentName?: string;
}

export interface UpdateChatMessageRequest {
  content?: string;
  isDeleted?: boolean;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ChatMessageListResponse {
  messages: ChatMessage[];
  pagination: PaginationInfo;
}

export interface CreateChatMessageReactionRequest {
  messageId: string;
  reaction: string;
}

// WebSocket Chat Message Types
export interface ChatMessageWebSocket extends ChatWebSocketMessage {
  type:
    | "chat-message"
    | "chat-message-edit"
    | "chat-message-delete"
    | "chat-reaction";
  data: {
    message: ChatMessage;
    userId?: string;
    publicUserId?: string;
    reaction?: string;
  };
}

export interface ChatReadStatusWebSocket extends ChatWebSocketMessage {
  type: "chat-read-status";
  data: {
    messageId: string;
    userId?: string;
    publicUserId?: string;
    readAt: string;
  };
}

export interface ChatTypingWebSocket extends ChatWebSocketMessage {
  type: "chat-typing" | "chat-typing-stop";
  data: {
    userId?: string;
    publicUserId?: string;
    userName: string;
  };
}

// Chat State Management Types
export interface ChatState {
  messages: ChatMessage[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  typingUsers: TypingUser[];
  pagination: PaginationInfo | null;
}

export interface TypingUser {
  id: string;
  name: string;
  isTyping: boolean;
}

// Chat Service Configuration
export interface ChatServiceConfig {
  apiBaseUrl: string;
  wsUrl: string;
  meetingId: string;
  token?: string;
  sessionId?: string;
  retryAttempts?: number;
  retryDelay?: number;
}

// Chat Component Props Types
export interface ChatPanelProps {
  meetingId: string;
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

export interface ChatMessageProps {
  message: ChatMessage;
  isOwn: boolean;
  onEdit: (messageId: string, content: string) => void;
  onDelete: (messageId: string) => void;
  onAddReaction: (messageId: string, reaction: string) => void;
  onReply: (content: string, replyToId?: string) => void;
}

export interface ChatMessagesProps {
  messages: ChatMessage[];
  currentUserId?: string;
  onEditMessage: (messageId: string, content: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onAddReaction: (messageId: string, reaction: string) => void;
  onReplyToMessage: (content: string, replyToId?: string) => void;
  isLoading?: boolean;
}

export interface ChatMessageInputProps {
  onSendMessage: (content: string, replyToId?: string) => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
  disabled?: boolean;
  replyToMessage?: {
    id: string;
    content: string;
    userName: string;
  };
  onCancelReply?: () => void;
  className?: string;
}

export interface ChatHeaderProps {
  unreadCount: number;
  isMinimized: boolean;
  onToggleMinimize: () => void;
  onClose: () => void;
  className?: string;
}

export interface ChatTypingIndicatorProps {
  users: TypingUser[];
}

// Chat Hook Options and Return Types
export interface UseChatOptions {
  meetingId: string;
  userId?: string;
  publicUserId?: string;
}

export interface UseChatReturn {
  // Messages
  messages: ChatMessage[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;

  // Actions
  sendMessage: (content: string, replyToId?: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  markAsRead: () => Promise<void>;
  loadMoreMessages: () => Promise<void>;

  // Typing
  typingUsers: TypingUser[];
  toggleTyping: () => void;

  // Reactions
  addReaction: (messageId: string, reaction: string) => Promise<void>;
  removeReaction: (messageId: string, reaction: string) => Promise<void>;

  // Real-time
  isConnected: boolean;
  reconnect: () => Promise<void>;

  // External WebSocket message handling
  handleWebSocketMessage: (message: any) => void;
}

// Chat Utility Types
export interface ChatUtils {
  formatMessageTime: (timestamp: string) => string;
  formatDate: (timestamp: string) => string;
  truncateMessage: (message: string, maxLength: number) => string;
  isValidUrl: (url: string) => boolean;
  extractUrls: (text: string) => string[];
  sanitizeContent: (content: string) => string;
}

// Chat Event Types
export interface ChatEvents {
  "message-sent": (message: ChatMessage) => void;
  "message-received": (message: ChatMessage) => void;
  "message-edited": (messageId: string, content: string) => void;
  "message-deleted": (messageId: string) => void;
  "reaction-added": (messageId: string, reaction: string) => void;
  "reaction-removed": (messageId: string, reaction: string) => void;
  "typing-start": (user: TypingUser) => void;
  "typing-stop": (userId: string) => void;
  "messages-read": () => void;
  error: (error: Error) => void;
  connected: () => void;
  disconnected: () => void;
}

// Type guard functions for chat messages
export function isChatMessage(
  message: ChatWebSocketMessage
): message is ChatMessageWebSocket {
  return [
    "chat-message",
    "chat-message-edit",
    "chat-message-delete",
    "chat-reaction",
  ].includes(message.type);
}

export function isChatTypingMessage(
  message: ChatWebSocketMessage
): message is ChatTypingWebSocket {
  return ["chat-typing", "chat-typing-stop"].includes(message.type);
}

export function isChatReadStatusMessage(
  message: ChatWebSocketMessage
): message is ChatReadStatusWebSocket {
  return message.type === "chat-read-status";
}

// Helper functions for message validation
export function isValidMessageContent(content: string): boolean {
  return content.trim().length > 0 && content.length <= 2000;
}

export function isValidReaction(reaction: string): boolean {
  const allowedReactions = ["👍", "❤️", "😂", "😮", "😢", "👎", "🔥", "🎉"];
  return allowedReactions.includes(reaction);
}

export function isOwnMessage(
  message: ChatMessage,
  userId?: string,
  publicUserId?: string
): boolean {
  return message.userId === userId || message.publicUserId === publicUserId;
}
