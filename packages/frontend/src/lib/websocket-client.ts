// WebSocket Client untuk komunikasi real-time dengan backend
import type {
  SignalingMessage,
  JoinPayload,
  LeavePayload,
  ChatMessagePayload,
} from "$types";
import { webSocketStore } from "$lib/stores";

export interface WebSocketClientOptions {
  meetingId: string;
  token?: string;
  sessionId?: string;
  onMessage?: (message: SignalingMessage) => void;
  onParticipantJoined?: (payload: JoinPayload) => void;
  onParticipantLeft?: (payload: LeavePayload) => void;
  onChatMessage?: (payload: ChatMessagePayload) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private options: WebSocketClientOptions;
  private isConnecting = false;
  private isDestroyed = false;
  private clientId: string;

  // Cleanup tracking
  private reconnectTimeoutId: NodeJS.Timeout | null = null;
  private cleanupLog: string[] = [];

  // State management integration
  private wsStore = webSocketStore;
  private unsubscribeFromStore: (() => void) | null = null;

  constructor(options: WebSocketClientOptions) {
    this.options = options;
    // Generate unique client ID using timestamp + random string
    this.clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log("[WebSocket] Generated client ID:", this.clientId);

    // Initialize WebSocket store
    this.wsStore.initialize();

    // Subscribe to store changes for monitoring
    this.unsubscribeFromStore = this.wsStore.subscribe((state) => {
      // Log state changes for debugging
      console.log("[WebSocket Store] State updated:", {
        connectionState: state.connectionState,
        isConnected: state.isConnected,
        reconnectAttempts: state.reconnectAttempts,
        lastError: state.lastError,
      });
    });
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isDestroyed) {
        reject(new Error("WebSocket client has been destroyed"));
        return;
      }

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      if (this.isConnecting) {
        reject(new Error("Connection already in progress"));
        return;
      }

      this.isConnecting = true;

      // Update WebSocket store state
      this.wsStore.connection.setConnectionState("connecting");

      try {
        const baseURL = import.meta.env.VITE_API_URL || "http://localhost:8080";
        // Remove /api/v1 from baseURL if it exists to avoid double path
        const cleanBaseURL = baseURL.replace(/\/api\/v1$/, "");
        const wsURL =
          cleanBaseURL.replace("http", "ws") +
          `/api/v1/ws/meetings/${this.options.meetingId}`;

        // Build URL with query parameters
        const url = new URL(wsURL);
        if (this.options.token) {
          url.searchParams.set("token", this.options.token);
          console.log("[WebSocket] Adding token to WebSocket connection");
        }
        if (this.options.sessionId) {
          url.searchParams.set("sessionId", this.options.sessionId);
          console.log(
            "[WebSocket] Adding sessionId to WebSocket connection:",
            this.options.sessionId
          );
        }

        console.log("[WebSocket] Connecting to:", url.toString());
        console.log(
          "[WebSocket] Connection params - Token present:",
          !!this.options.token,
          "SessionId present:",
          !!this.options.sessionId
        );

        // Update WebSocket store with connection details
        this.wsStore.connection.setConnectionDetails(
          this.options.meetingId,
          this.clientId,
          url.toString()
        );

        this.ws = new WebSocket(url.toString());

        this.ws.onopen = () => {
          console.log("[WebSocket] Connected successfully");
          this.isConnecting = false;

          // Update WebSocket store state
          this.wsStore.connection.onConnectionSuccess();

          this.options.onConnect?.();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: SignalingMessage = JSON.parse(event.data);
            console.log("[WebSocket] Received message:", message);

            // Track message in WebSocket store
            this.wsStore.messages.onMessageReceived(
              message.type,
              JSON.stringify(message).length
            );

            // Handle different message types
            switch (message.type) {
              case "participant-joined":
                this.options.onParticipantJoined?.(message.data as JoinPayload);
                break;
              case "participant-left":
                this.options.onParticipantLeft?.(message.data as LeavePayload);
                break;
              case "chat-message":
                this.options.onChatMessage?.(
                  message.data as ChatMessagePayload
                );
                break;
              default:
                // Pass through other message types
                this.options.onMessage?.(message);
            }
          } catch (error) {
            console.error("[WebSocket] Failed to parse message:", error);
          }
        };

        this.ws.onclose = (event) => {
          console.log(
            "[WebSocket] Connection closed:",
            event.code,
            event.reason
          );
          this.isConnecting = false;

          // Update WebSocket store state
          this.wsStore.connection.onConnectionLost(
            `Connection closed: ${event.code} - ${event.reason}`
          );

          this.options.onDisconnect?.();

          // Attempt to reconnect if not explicitly closed
          if (!this.isDestroyed && event.code !== 1000) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error("[WebSocket] Error:", error);
          this.isConnecting = false;

          // Update WebSocket store state
          this.wsStore.connection.onConnectionFailure(
            "WebSocket connection error"
          );

          this.options.onError?.(new Error("WebSocket connection error"));
          reject(new Error("WebSocket connection error"));
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  private scheduleReconnect() {
    // Use WebSocket store for reconnection logic
    const delay = this.wsStore.connection.startReconnection();

    if (delay === undefined) {
      // Reconnection should not proceed
      return;
    }

    console.log(`[WebSocket] Scheduling reconnect attempt in ${delay}ms`);

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      if (!this.isDestroyed) {
        this.connect().catch((error) => {
          console.error("[WebSocket] Reconnect failed:", error);
          this.wsStore.connection.onReconnectionFailure(
            error instanceof Error ? error.message : "Reconnect failed"
          );
        });
      }
    }, delay);
  }

  // Cleanup logging utilities
  private logCleanup(activity: string, details?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [WebSocket-Cleanup] ${activity}${details ? ` - ${JSON.stringify(details)}` : ""}`;
    this.cleanupLog.push(logEntry);
    console.log(logEntry);
  }

  send(message: SignalingMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log("[WebSocket] Sending message:", message);
      const messageData = JSON.stringify(message);
      this.ws.send(messageData);

      // Track message in WebSocket store
      this.wsStore.messages.onMessageSent(message.type, messageData.length);
    } else {
      console.error(
        "[WebSocket] Cannot send message - WebSocket not connected"
      );
    }
  }

  join(): void {
    this.send({
      type: "join",
      meetingId: this.options.meetingId,
      from: this.clientId,
      to: "",
      data: {},
      timestamp: new Date(),
    });
  }

  leave(): void {
    this.send({
      type: "leave",
      meetingId: this.options.meetingId,
      from: this.clientId,
      to: "",
      data: {},
      timestamp: new Date(),
    });
  }

  sendOffer(to: string, offer: RTCSessionDescriptionInit): void {
    this.send({
      type: "offer",
      meetingId: this.options.meetingId,
      from: this.clientId,
      to,
      data: offer,
      timestamp: new Date(),
    });
  }

  sendAnswer(to: string, answer: RTCSessionDescriptionInit): void {
    this.send({
      type: "answer",
      meetingId: this.options.meetingId,
      from: this.clientId,
      to,
      data: answer,
      timestamp: new Date(),
    });
  }

  sendIceCandidate(to: string, candidate: RTCIceCandidateInit): void {
    this.send({
      type: "ice-candidate",
      meetingId: this.options.meetingId,
      from: this.clientId,
      to,
      data: candidate,
      timestamp: new Date(),
    });
  }

  sendChatMessage(content: string, messageType = "text"): void {
    this.send({
      type: "chat-message",
      meetingId: this.options.meetingId,
      from: this.clientId,
      to: "",
      data: {
        content,
        messageType,
      },
      timestamp: new Date(),
    });
  }

  // Public method to get client ID
  getClientId(): string {
    return this.clientId;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getConnectionState(): string {
    if (!this.ws) return "disconnected";

    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return "connecting";
      case WebSocket.OPEN:
        return "connected";
      case WebSocket.CLOSING:
        return "closing";
      case WebSocket.CLOSED:
        return "closed";
      default:
        return "unknown";
    }
  }

  destroy(): void {
    this.logCleanup("Starting WebSocket client destruction");

    try {
      // Mark as destroyed first to prevent new operations
      this.isDestroyed = true;

      // Clear reconnect timeout if exists
      if (this.reconnectTimeoutId) {
        clearTimeout(this.reconnectTimeoutId);
        this.reconnectTimeoutId = null;
        this.logCleanup("Reconnect timeout cleared");
      }

      // Close WebSocket connection if exists
      if (this.ws) {
        const currentState = this.getConnectionState();
        this.logCleanup("Closing WebSocket connection", { currentState });

        // Remove all event listeners to prevent memory leaks
        this.ws.onopen = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;

        // Close the connection
        if (
          this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING
        ) {
          this.ws.close(1000, "Client destroyed");
        }

        this.ws = null;
        this.logCleanup("WebSocket connection closed and cleaned up");
      }

      // Update WebSocket store state
      this.wsStore.connection.resetConnection();

      // Clear callbacks to prevent memory leaks
      this.options.onConnect = undefined;
      this.options.onDisconnect = undefined;
      this.options.onError = undefined;
      this.options.onMessage = undefined;
      this.options.onParticipantJoined = undefined;
      this.options.onParticipantLeft = undefined;
      this.options.onChatMessage = undefined;

      // Unsubscribe from store
      if (this.unsubscribeFromStore) {
        this.unsubscribeFromStore();
        this.unsubscribeFromStore = null;
      }

      this.logCleanup("WebSocket client destroyed successfully");
    } catch (error) {
      this.logCleanup("Error during WebSocket client destruction", error);
      console.error("[WebSocket-Cleanup] Error during destroy:", error);
    }
  }

  // Public method to get cleanup status (for debugging)
  getCleanupStatus(): {
    isDestroyed: boolean;
    isConnected: boolean;
    connectionState: string;
    hasReconnectTimeout: boolean;
    cleanupLog: string[];
  } {
    return {
      isDestroyed: this.isDestroyed,
      isConnected: this.isConnected(),
      connectionState: this.getConnectionState(),
      hasReconnectTimeout: !!this.reconnectTimeoutId,
      cleanupLog: [...this.cleanupLog],
    };
  }
}

// Factory function untuk membuat WebSocket client
export function createWebSocketClient(
  options: WebSocketClientOptions
): WebSocketClient {
  return new WebSocketClient(options);
}
