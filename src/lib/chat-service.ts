import { apiClient, APIException } from "./api-client";
import { WebSocketService } from "./websocket-service";
import {
  ChatMessage,
  ChatMessageListResponse,
  CreateChatMessageRequest,
  UpdateChatMessageRequest,
  CreateChatMessageReactionRequest,
  ChatServiceConfig,
  ChatWebSocketMessage,
  ChatMessageWebSocket,
  ChatReadStatusWebSocket,
  ChatTypingWebSocket,
  TypingUser,
  ChatEvents,
  isChatMessage,
  isChatTypingMessage,
  isChatReadStatusMessage,
  isValidMessageContent,
  isValidReaction,
} from "@/types/chat";

export class ChatService {
  private config: ChatServiceConfig;
  private wsService: WebSocketService | null = null;
  private eventListeners: Map<keyof ChatEvents, Function[]> = new Map();
  private typingTimeout: NodeJS.Timeout | null = null;
  private currentTypingUsers: Map<string, TypingUser> = new Map();

  constructor(
    config: ChatServiceConfig,
    externalWebSocketService?: WebSocketService
  ) {
    this.config = {
      retryAttempts: 3,
      retryDelay: 1000,
      ...config,
    };

    // Use external WebSocket service if provided (for shared connection with WebRTC)
    if (externalWebSocketService) {
      this.wsService = externalWebSocketService;
      console.log("[DEBUG] ChatService using external WebSocket service");
    }
  }

  /**
   * Initialize chat service and connect to WebSocket
   */
  async initialize(): Promise<void> {
    try {
      // If we don't have an external WebSocket service, create our own
      if (!this.wsService) {
        await this.connectWebSocket();
      } else {
        // Set up event listeners for the external WebSocket service
        this.setupWebSocketEventListeners();
        this.emit("connected");
        console.log(
          "[DEBUG] ChatService initialized with external WebSocket service"
        );
      }
    } catch (error) {
      console.error("Failed to initialize chat service:", error);
      throw error;
    }
  }

  /**
   * Set up WebSocket event listeners (shared with external service)
   */
  private setupWebSocketEventListeners(): void {
    if (!this.wsService) return;

    this.wsService.on("connected", () => {
      this.emit("connected");
    });

    this.wsService.on("disconnected", () => {
      this.emit("disconnected");
    });

    this.wsService.on("message", (message) => {
      this.handleWebSocketMessage(message);
    });

    this.wsService.on("error", (error) => {
      this.emit("error", error);
    });

    this.wsService.on("reconnecting", (attempt) => {
      console.log(`Chat WebSocket reconnecting... Attempt ${attempt}`);
    });
  }

  /**
   * Connect to WebSocket for real-time chat
   */
  private async connectWebSocket(): Promise<void> {
    if (!this.config.wsUrl || !this.config.meetingId) {
      throw new Error("WebSocket URL and meeting ID are required");
    }

    this.wsService = new WebSocketService({
      url: this.config.wsUrl,
      meetingId: this.config.meetingId,
      token: this.config.token,
      sessionId: this.config.sessionId,
      reconnectAttempts: this.config.retryAttempts,
      reconnectDelay: this.config.retryDelay,
    });

    // Set up event listeners
    this.setupWebSocketEventListeners();

    // Connect to WebSocket
    await this.wsService.connect();
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(message: any): void {
    try {
      if (!message) {
        console.warn("Received null or undefined WebSocket message");
        return;
      }

      // Ensure message has required properties
      if (!message.type || !message.data) {
        console.warn("Invalid WebSocket message structure:", message);
        return;
      }

      // Check if it's a chat message
      if (isChatMessage(message)) {
        this.handleChatMessage(message);
      }
      // Check if it's a typing indicator
      else if (isChatTypingMessage(message)) {
        this.handleTypingMessage(message);
      }
      // Check if it's a read status
      else if (isChatReadStatusMessage(message)) {
        this.handleReadStatusMessage(message);
      } else {
        console.warn("Unknown WebSocket message type:", message.type);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
    }
  }

  /**
   * Handle chat messages (new, edited, deleted, reactions)
   */
  private handleChatMessage(message: ChatMessageWebSocket): void {
    if (!message || !message.type || !message.data) {
      console.warn("Invalid chat message structure:", message);
      return;
    }

    const { type, data } = message;

    switch (type) {
      case "chat-message":
        if (data.message) {
          // Ensure message has required fields
          if (!data.message.id || !data.message.content) {
            console.warn("Chat message missing required fields:", data.message);
            return;
          }
          this.emit("message-received", data.message);
        } else {
          console.warn("Chat message missing message data:", data);
        }
        break;
      case "chat-message-edit":
        if (data.message?.id && data.message?.content !== undefined) {
          this.emit("message-edited", data.message.id, data.message.content);
        } else {
          console.warn("Chat message edit missing required data:", data);
        }
        break;
      case "chat-message-delete":
        if (data.message?.id) {
          this.emit("message-deleted", data.message.id);
        } else {
          console.warn("Chat message delete missing message ID:", data);
        }
        break;
      case "chat-reaction":
        if (data.message?.id && data.reaction) {
          this.emit("reaction-added", data.message.id, data.reaction);
        } else {
          console.warn("Chat reaction missing required data:", data);
        }
        break;
      default:
        console.warn("Unknown chat message type:", type);
    }
  }

  /**
   * Handle typing indicators
   */
  private handleTypingMessage(message: ChatTypingWebSocket): void {
    if (!message || !message.type || !message.data) {
      console.warn("Invalid typing message structure:", message);
      return;
    }

    const { type, data } = message;

    // Get user ID from different possible sources
    let userId = data.userId || data.publicUserId;

    // If no user ID, generate one from the message source
    if (!userId) {
      userId = message.from || "unknown";
    }

    if (!userId) {
      console.warn("Typing message missing user ID:", data);
      return;
    }

    if (type === "chat-typing") {
      const typingUser: TypingUser = {
        id: userId,
        name: data.userName || "Unknown User",
        isTyping: true,
      };
      this.currentTypingUsers.set(userId, typingUser);
      this.emit("typing-start", typingUser);
    } else if (type === "chat-typing-stop") {
      const typingUser = this.currentTypingUsers.get(userId);
      if (typingUser) {
        typingUser.isTyping = false;
        this.emit("typing-stop", userId);
        this.currentTypingUsers.delete(userId);
      }
    } else {
      console.warn("Unknown typing message type:", type);
    }
  }

  /**
   * Handle read status updates
   */
  private handleReadStatusMessage(message: ChatReadStatusWebSocket): void {
    if (!message || !message.data) {
      console.warn("Invalid read status message structure:", message);
      return;
    }

    const { data } = message;

    // Validate required data
    if (!data.messageId && data.messageId !== "all") {
      console.warn("Read status message missing messageId:", data);
      return;
    }

    this.emit("messages-read");
  }

  /**
   * Get chat messages for a meeting
   */
  async getMessages(
    page: number = 1,
    limit: number = 50
  ): Promise<ChatMessageListResponse> {
    try {
      if (!this.config.meetingId) {
        throw new Error("Meeting ID is required");
      }

      const response = await apiClient.request<{
        success: boolean;
        data: ChatMessageListResponse;
        message?: string;
      }>(
        `/meetings/${this.config.meetingId}/messages?page=${page}&limit=${limit}`
      );

      // Validate response structure
      if (!response) {
        throw new Error(
          "Invalid response from API: Response is null or undefined"
        );
      }

      if (!response.success) {
        throw new Error(response.message || "API request failed");
      }

      if (!response.data) {
        throw new Error("Invalid response structure: Missing data property");
      }

      // Ensure messages array exists
      if (!response.data.messages) {
        console.warn("API returned null messages, using empty array");
        response.data.messages = [];
      }

      // Ensure pagination exists
      if (!response.data.pagination) {
        console.warn("API returned null pagination, using default");
        response.data.pagination = {
          page: page,
          limit: limit,
          total: 0,
          totalPages: 0,
        };
      }

      return response.data;
    } catch (error) {
      console.error("Failed to get chat messages:", error);
      throw this.handleError(error);
    }
  }

  /**
   * Send a new chat message
   */
  async sendMessage(
    content: string,
    replyToId?: string,
    attachmentUrl?: string,
    attachmentType?: string,
    attachmentName?: string
  ): Promise<ChatMessage> {
    try {
      // Validate required fields
      if (!this.config.meetingId) {
        throw new Error("Meeting ID is required");
      }

      // Validate message content
      if (!isValidMessageContent(content)) {
        throw new Error("Invalid message content");
      }

      // Validate attachment data if provided
      if (attachmentUrl && !attachmentType) {
        throw new Error(
          "Attachment type is required when attachment URL is provided"
        );
      }

      const request: CreateChatMessageRequest = {
        meetingId: this.config.meetingId!,
        messageType: attachmentUrl ? "file" : "text",
        content,
        replyToId,
        attachmentUrl,
        attachmentType,
        attachmentName,
      };

      const response = await apiClient.request<{
        success: boolean;
        data: ChatMessage;
        message?: string;
      }>(`/meetings/${this.config.meetingId}/messages`, {
        method: "POST",
        body: JSON.stringify(request),
      });

      // Validate response
      if (!response) {
        throw new Error(
          "Invalid response from API: Response is null or undefined"
        );
      }

      if (!response.success) {
        throw new Error(response.message || "Failed to send message");
      }

      if (!response.data) {
        throw new Error("Invalid response structure: Missing data property");
      }

      // Send via WebSocket for real-time delivery
      this.sendWebSocketMessage("chat-message", {
        message: response.data,
        userId: this.config.token ? undefined : "current", // Will be set by backend
        publicUserId: this.config.sessionId ? undefined : "current", // Will be set by backend
      });

      this.emit("message-sent", response.data);
      return response.data;
    } catch (error) {
      console.error("Failed to send message:", error);
      throw this.handleError(error);
    }
  }

  /**
   * Edit an existing message
   */
  async editMessage(messageId: string, content: string): Promise<void> {
    try {
      // Validate required fields
      if (!this.config.meetingId) {
        throw new Error("Meeting ID is required");
      }

      if (!messageId || messageId.trim() === "") {
        throw new Error("Message ID is required");
      }

      if (!isValidMessageContent(content)) {
        throw new Error("Invalid message content");
      }

      const request: UpdateChatMessageRequest = {
        content,
      };

      const response = await apiClient.request<{
        success: boolean;
        message?: string;
      }>(`/meetings/${this.config.meetingId}/messages/${messageId}`, {
        method: "PUT",
        body: JSON.stringify(request),
      });

      // Validate response
      if (!response) {
        throw new Error(
          "Invalid response from API: Response is null or undefined"
        );
      }

      if (!response.success) {
        throw new Error(response.message || "Failed to edit message");
      }

      // Send via WebSocket for real-time update
      this.sendWebSocketMessage("chat-message-edit", {
        message: { id: messageId, content } as ChatMessage,
        userId: this.config.token ? undefined : "current",
        publicUserId: this.config.sessionId ? undefined : "current",
      });

      this.emit("message-edited", messageId, content);
    } catch (error) {
      console.error("Failed to edit message:", error);
      throw this.handleError(error);
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string): Promise<void> {
    try {
      // Validate required fields
      if (!this.config.meetingId) {
        throw new Error("Meeting ID is required");
      }

      if (!messageId || messageId.trim() === "") {
        throw new Error("Message ID is required");
      }

      const request: UpdateChatMessageRequest = {
        isDeleted: true,
      };

      const response = await apiClient.request<{
        success: boolean;
        message?: string;
      }>(`/meetings/${this.config.meetingId}/messages/${messageId}`, {
        method: "PUT",
        body: JSON.stringify(request),
      });

      // Validate response
      if (!response) {
        throw new Error(
          "Invalid response from API: Response is null or undefined"
        );
      }

      if (!response.success) {
        throw new Error(response.message || "Failed to delete message");
      }

      // Send via WebSocket for real-time update
      this.sendWebSocketMessage("chat-message-delete", {
        message: { id: messageId } as ChatMessage,
        userId: this.config.token ? undefined : "current",
        publicUserId: this.config.sessionId ? undefined : "current",
      });

      this.emit("message-deleted", messageId);
    } catch (error) {
      console.error("Failed to delete message:", error);
      throw this.handleError(error);
    }
  }

  /**
   * Add reaction to a message
   */
  async addReaction(messageId: string, reaction: string): Promise<void> {
    try {
      if (!this.config.meetingId) {
        throw new Error("Meeting ID is required");
      }

      if (!isValidReaction(reaction)) {
        throw new Error("Invalid reaction");
      }

      const request: CreateChatMessageReactionRequest = {
        messageId,
        reaction,
      };

      const response = await apiClient.request<{
        success: boolean;
        data?: any;
        message?: string;
      }>(`/meetings/${this.config.meetingId}/messages/${messageId}/reactions`, {
        method: "POST",
        body: JSON.stringify(request),
      });

      // Validate response
      if (!response) {
        throw new Error(
          "Invalid response from API: Response is null or undefined"
        );
      }

      if (!response.success) {
        throw new Error(response.message || "Failed to add reaction");
      }

      // Send via WebSocket for real-time update
      this.sendWebSocketMessage("chat-reaction", {
        message: { id: messageId } as ChatMessage,
        reaction,
        userId: this.config.token ? undefined : "current",
        publicUserId: this.config.sessionId ? undefined : "current",
      });

      this.emit("reaction-added", messageId, reaction);
    } catch (error) {
      console.error("Failed to add reaction:", error);
      throw this.handleError(error);
    }
  }

  /**
   * Remove reaction from a message
   */
  async removeReaction(messageId: string, reaction: string): Promise<void> {
    try {
      if (!this.config.meetingId) {
        throw new Error("Meeting ID is required");
      }

      const response = await apiClient.request<{
        success: boolean;
        message?: string;
      }>(`/meetings/${this.config.meetingId}/messages/${messageId}/reactions`, {
        method: "DELETE",
        body: JSON.stringify({ reaction }),
      });

      // Validate response
      if (!response) {
        throw new Error(
          "Invalid response from API: Response is null or undefined"
        );
      }

      if (!response.success) {
        throw new Error(response.message || "Failed to remove reaction");
      }

      this.emit("reaction-removed", messageId, reaction);
    } catch (error) {
      console.error("Failed to remove reaction:", error);
      throw this.handleError(error);
    }
  }

  /**
   * Mark messages as read
   */
  async markAsRead(): Promise<void> {
    try {
      if (!this.config.meetingId) {
        throw new Error("Meeting ID is required");
      }

      const response = await apiClient.request<{
        success: boolean;
        message?: string;
      }>(`/meetings/${this.config.meetingId}/messages/read`, {
        method: "POST",
      });

      // Validate response
      if (!response) {
        throw new Error(
          "Invalid response from API: Response is null or undefined"
        );
      }

      if (!response.success) {
        throw new Error(response.message || "Failed to mark messages as read");
      }

      // Send via WebSocket for real-time update
      this.sendWebSocketMessage("chat-read-status", {
        messageId: "all",
        userId: this.config.token ? undefined : "current",
        publicUserId: this.config.sessionId ? undefined : "current",
        readAt: new Date().toISOString(),
      });

      this.emit("messages-read");
    } catch (error) {
      console.error("Failed to mark messages as read:", error);
      throw this.handleError(error);
    }
  }

  /**
   * Send typing indicator
   */
  sendTypingStart(userName?: string): void {
    if (!this.config.meetingId) {
      console.warn("Cannot send typing start: meeting ID not configured");
      return;
    }

    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }

    this.sendWebSocketMessage("chat-typing", {
      userId: this.config.token ? undefined : "current",
      publicUserId: this.config.sessionId ? undefined : "current",
      userName: userName || "Current User",
    });

    // Auto-stop typing after 3 seconds of inactivity
    this.typingTimeout = setTimeout(() => {
      this.sendTypingStop();
    }, 3000);
  }

  /**
   * Stop typing indicator
   */
  sendTypingStop(userName?: string): void {
    if (!this.config.meetingId) {
      console.warn("Cannot send typing stop: meeting ID not configured");
      return;
    }

    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }

    this.sendWebSocketMessage("chat-typing-stop", {
      userId: this.config.token ? undefined : "current",
      publicUserId: this.config.sessionId ? undefined : "current",
      userName: userName || "Current User",
    });
  }

  /**
   * Get current typing users
   */
  getTypingUsers(): TypingUser[] {
    return Array.from(this.currentTypingUsers.values());
  }

  /**
   * Send message via WebSocket
   */
  private sendWebSocketMessage(type: string, data: any): void {
    if (!type || typeof type !== "string") {
      console.warn("Invalid message type:", type);
      return;
    }

    if (!this.config.meetingId) {
      console.warn("Cannot send message: meeting ID not configured");
      return;
    }

    if (this.wsService && this.wsService.getState() === "connected") {
      // Format message to match backend expectations
      const message: ChatWebSocketMessage = {
        type: type as any,
        meetingId: this.config.meetingId,
        from: this.config.token || this.config.sessionId || "anonymous",
        data: data || {},
        timestamp: new Date().toISOString(),
      };

      try {
        this.wsService.send(message as any);
      } catch (error) {
        console.error("Failed to send WebSocket message:", error);
      }
    } else {
      console.warn("WebSocket not connected, cannot send message:", type);
    }
  }

  /**
   * Handle API errors
   */
  private handleError(error: any): Error {
    if (error instanceof APIException) {
      // Return more specific error message from API
      const errorMessage =
        error.error?.message || error.error?.details || "API error occurred";
      return new Error(errorMessage);
    }
    if (error instanceof Error) {
      return error;
    }
    if (typeof error === "string") {
      return new Error(error);
    }
    if (error && typeof error === "object" && "message" in error) {
      return new Error(error.message);
    }
    return new Error("An unknown error occurred");
  }

  /**
   * Add event listener
   */
  on<K extends keyof ChatEvents>(event: K, callback: ChatEvents[K]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof ChatEvents>(event: K, callback: ChatEvents[K]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Emit event to all listeners
   */
  private emit<K extends keyof ChatEvents>(
    event: K,
    ...args: Parameters<ChatEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(...args);
        } catch (error) {
          console.error(
            `Error in chat service event listener for ${String(event)}:`,
            error
          );
        }
      });
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.wsService?.getState() === "connected" || false;
  }

  /**
   * Reconnect WebSocket
   */
  async reconnect(): Promise<void> {
    if (this.wsService) {
      this.wsService.disconnect();
      await this.connectWebSocket();
    }
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }

    if (this.wsService) {
      this.wsService.disconnect();
      this.wsService = null;
    }

    this.currentTypingUsers.clear();
    this.eventListeners.clear();
  }
}

/**
 * Create chat service instance
 */
export function createChatService(
  config: ChatServiceConfig,
  externalWebSocketService?: WebSocketService
): ChatService {
  return new ChatService(config, externalWebSocketService);
}
