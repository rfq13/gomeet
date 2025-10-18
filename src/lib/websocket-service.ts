import {
  WebSocketMessage,
  SignalingMessage,
  WebSocketState,
  WebSocketConfig,
  WebSocketServiceEvents,
} from "@/types/webrtc";
import type {
  ChatWebSocketMessage,
  ChatMessageWebSocket,
  ChatTypingWebSocket,
  ChatReadStatusWebSocket,
} from "@/types/chat";
import {
  isChatMessage,
  isChatTypingMessage,
  isChatReadStatusMessage,
} from "@/types/chat";

export class WebSocketService {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private state: WebSocketState = "disconnected";
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectDelay: number;
  private maxReconnectDelay: number;
  private eventListeners: Map<keyof WebSocketServiceEvents, Function[]> =
    new Map();
  private reconnectTimeoutId: NodeJS.Timeout | null = null;

  // Singleton pattern implementation
  private static instances: Map<string, WebSocketService> = new Map();

  constructor(config: WebSocketConfig) {
    this.config = {
      reconnectAttempts: 5,
      reconnectDelay: 1000,
      maxReconnectDelay: 30000,
      ...config,
    };

    this.maxReconnectAttempts = this.config.reconnectAttempts!;
    this.reconnectDelay = this.config.reconnectDelay!;
    this.maxReconnectDelay = this.config.maxReconnectDelay!;
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.state === "connected" || this.state === "connecting") {
        resolve();
        return;
      }

      this.setState("connecting");

      const url = this.buildWebSocketUrl();
      console.log("WebSocket connecting to:", url);

      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log("WebSocket connected successfully");
          this.setState("connected");
          this.reconnectAttempts = 0;
          this.emit("connected");
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event);
        };

        this.ws.onclose = (event) => {
          console.log("WebSocket closed:", event.code, event.reason);
          this.handleClose(event);
        };

        this.ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          this.handleError(error);
          reject(new Error("WebSocket connection error"));
        };
      } catch (error) {
        this.handleError(new Event("error"));
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setState("disconnected");
  }

  /**
   * Send message through WebSocket
   */
  send(message: WebSocketMessage): boolean {
    if (this.state !== "connected" || !this.ws) {
      console.error("WebSocket not connected, cannot send message:", message);
      return false;
    }

    try {
      const messageWithTimestamp = {
        ...message,
        timestamp: new Date().toISOString(),
      };

      this.ws.send(JSON.stringify(messageWithTimestamp));
      return true;
    } catch (error) {
      console.error("Error sending WebSocket message:", error);
      return false;
    }
  }

  /**
   * Get current connection state
   */
  getState(): WebSocketState {
    return this.state;
  }

  /**
   * Add event listener
   */
  on<K extends keyof WebSocketServiceEvents>(
    event: K,
    callback: WebSocketServiceEvents[K]
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof WebSocketServiceEvents>(
    event: K,
    callback: WebSocketServiceEvents[K]
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
   * Build WebSocket URL with authentication
   */
  private buildWebSocketUrl(): string {
    // Remove /api/v1 suffix if present to avoid duplication
    let baseUrl = this.config.url.replace(/^http/, "ws");
    if (baseUrl.endsWith("/api/v1")) {
      baseUrl = baseUrl.slice(0, -7); // Remove '/api/v1'
    }

    const wsUrl = `${baseUrl}/api/v1/ws/meetings/${this.config.meetingId}`;

    const params = new URLSearchParams();

    if (this.config.token) {
      params.append("token", this.config.token);
    } else if (this.config.sessionId) {
      params.append("sessionId", this.config.sessionId);
    }

    const queryString = params.toString();
    return queryString ? `${wsUrl}?${queryString}` : wsUrl;
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);
      console.log("[DEBUG] WebSocket received message:", message.type, message);

      // Check if it's a chat message
      if (
        isChatMessage(message) ||
        isChatTypingMessage(message) ||
        isChatReadStatusMessage(message)
      ) {
        console.log(
          "[DEBUG] WebSocket handling as chat message:",
          message.type
        );
        // Emit chat messages through the message channel
        this.emit("message", message as any);
      } else {
        // Handle as signaling message
        console.log(
          "[DEBUG] WebSocket handling as signaling message:",
          message.type
        );
        const signalingMessage: SignalingMessage = message;
        this.emit("message", signalingMessage);
      }
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
    }
  }

  /**
   * Handle WebSocket close event
   */
  private handleClose(event: CloseEvent): void {
    this.setState("disconnected");
    this.emit("disconnected");

    // Attempt to reconnect if not explicitly closed
    if (
      event.code !== 1000 &&
      this.reconnectAttempts < this.maxReconnectAttempts
    ) {
      this.attemptReconnect();
    }
  }

  /**
   * Handle WebSocket error event
   */
  private handleError(error: Event): void {
    this.setState("error");
    this.emit("error", new Error("WebSocket connection error"));
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    this.setState("reconnecting");
    this.reconnectAttempts++;

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    this.emit("reconnecting", this.reconnectAttempts);

    this.reconnectTimeoutId = setTimeout(() => {
      this.connect().catch((error) => {
        console.error("Reconnection attempt failed:", error);
      });
    }, delay);
  }

  /**
   * Set connection state and emit state change
   */
  private setState(newState: WebSocketState): void {
    this.state = newState;
  }

  /**
   * Emit event to all listeners
   */
  private emit<K extends keyof WebSocketServiceEvents>(
    event: K,
    ...args: Parameters<WebSocketServiceEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(...args);
        } catch (error) {
          console.error(
            `Error in WebSocket event listener for ${String(event)}:`,
            error
          );
        }
      });
    }
  }

  /**
   * Get singleton instance for WebSocket service
   * Prevents multiple instances for the same meeting/session
   */
  static getInstance(config: WebSocketConfig): WebSocketService {
    const key = `${config.meetingId}_${config.sessionId || config.token}`;

    if (!this.instances.has(key)) {
      console.log(
        "[DEBUG] Creating new WebSocket service instance for key:",
        key
      );
      const instance = new WebSocketService(config);
      this.instances.set(key, instance);

      // Add cleanup on disconnect to prevent memory leaks
      instance.on("disconnected", () => {
        // Only remove instance if it's actually disconnected (not reconnecting)
        if (instance.getState() === "disconnected") {
          console.log(
            "[DEBUG] Cleaning up WebSocket service instance for key:",
            key
          );
          this.instances.delete(key);
        }
      });
    } else {
      console.log(
        "[DEBUG] Reusing existing WebSocket service instance for key:",
        key
      );
    }

    return this.instances.get(key)!;
  }

  /**
   * Clean up all instances (useful for testing or app shutdown)
   */
  static cleanupAllInstances(): void {
    console.log("[DEBUG] Cleaning up all WebSocket service instances");
    this.instances.forEach((instance, key) => {
      instance.disconnect();
    });
    this.instances.clear();
  }

  /**
   * Get active instance count (for debugging)
   */
  static getActiveInstanceCount(): number {
    return this.instances.size;
  }
}

/**
 * Create WebSocket service instance (deprecated - use getInstance instead)
 * @deprecated Use WebSocketService.getInstance() for singleton pattern
 */
export function createWebSocketService(
  config: WebSocketConfig
): WebSocketService {
  console.warn(
    "[WARN] createWebSocketService is deprecated. Use WebSocketService.getInstance() instead."
  );
  return WebSocketService.getInstance(config);
}
