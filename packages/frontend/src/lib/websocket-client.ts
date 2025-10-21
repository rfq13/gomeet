// WebSocket Client untuk komunikasi real-time dengan backend
import type {
  SignalingMessage,
  JoinPayload,
  LeavePayload,
  ChatMessagePayload,
} from "$types";

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
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnecting = false;
  private isDestroyed = false;
  private clientId: string;

  constructor(options: WebSocketClientOptions) {
    this.options = options;
    // Generate unique client ID using timestamp + random string
    this.clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log("[WebSocket] Generated client ID:", this.clientId);
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
        }
        if (this.options.sessionId) {
          url.searchParams.set("sessionId", this.options.sessionId);
        }

        console.log("[WebSocket] Connecting to:", url.toString());

        this.ws = new WebSocket(url.toString());

        this.ws.onopen = () => {
          console.log("[WebSocket] Connected successfully");
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.options.onConnect?.();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: SignalingMessage = JSON.parse(event.data);
            console.log("[WebSocket] Received message:", message);

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
          this.options.onDisconnect?.();

          // Attempt to reconnect if not explicitly closed
          if (
            !this.isDestroyed &&
            event.code !== 1000 &&
            this.reconnectAttempts < this.maxReconnectAttempts
          ) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error("[WebSocket] Error:", error);
          this.isConnecting = false;
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
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `[WebSocket] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`
    );

    setTimeout(() => {
      if (!this.isDestroyed) {
        this.connect().catch((error) => {
          console.error("[WebSocket] Reconnect failed:", error);
        });
      }
    }, delay);
  }

  send(message: SignalingMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log("[WebSocket] Sending message:", message);
      this.ws.send(JSON.stringify(message));
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
    this.isDestroyed = true;

    if (this.ws) {
      this.ws.close(1000, "Client destroyed");
      this.ws = null;
    }
  }
}

// Factory function untuk membuat WebSocket client
export function createWebSocketClient(
  options: WebSocketClientOptions
): WebSocketClient {
  return new WebSocketClient(options);
}
