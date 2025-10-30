import { get } from "svelte/store";
import { webSocketStore, type WebSocketState } from "./websocket.store";
import {
  createWebSocketClient,
  type WebSocketClient,
  type WebSocketClientOptions,
} from "$lib/websocket-client";
import type {
  SignalingMessage,
  JoinPayload,
  LeavePayload,
  ChatMessagePayload,
} from "$types";

// Enhanced WebSocket client options with state management
export interface WebSocketIntegrationOptions
  extends Omit<
    WebSocketClientOptions,
    "onConnect" | "onDisconnect" | "onError"
  > {
  // Enhanced callbacks with state context
  onConnectionStateChange?: (state: WebSocketState) => void;
  onReconnectionAttempt?: (attempt: number, maxAttempts: number) => void;
  onConnectionStatsUpdate?: (stats: WebSocketState["stats"]) => void;

  // Backward compatibility
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

// WebSocket integration class that combines store and client
export class WebSocketIntegration {
  private client: WebSocketClient | null = null;
  private options: WebSocketIntegrationOptions;
  private store = webSocketStore;
  private unsubscribeFromStore: (() => void) | null = null;
  private isInitialized = false;

  constructor(options: WebSocketIntegrationOptions) {
    this.options = options;
    this.initializeStoreSubscription();
  }

  // Initialize store subscription for monitoring
  private initializeStoreSubscription() {
    this.unsubscribeFromStore = this.store.subscribe((state) => {
      // Notify about connection state changes
      this.options.onConnectionStateChange?.(state);

      // Notify about stats updates
      this.options.onConnectionStatsUpdate?.(state.stats);

      // Handle reconnection attempts
      if (state.connectionState === "reconnecting") {
        this.options.onReconnectionAttempt?.(
          state.reconnectAttempts,
          state.maxReconnectAttempts
        );
      }

      // Backward compatibility callbacks
      if (state.connectionState === "connected" && !this.isInitialized) {
        this.options.onConnect?.();
        this.isInitialized = true;
      } else if (
        state.connectionState === "disconnected" &&
        this.isInitialized
      ) {
        this.options.onDisconnect?.();
        this.isInitialized = false;
      } else if (state.connectionState === "error") {
        this.options.onError?.(new Error(state.lastError || "WebSocket error"));
      }
    });
  }

  // Connect to WebSocket with enhanced error handling
  async connect(): Promise<void> {
    try {
      if (this.client) {
        console.warn(
          "[WebSocket Integration] Client already exists, destroying previous instance"
        );
        this.destroy();
      }

      // Create client with store-integrated callbacks
      const clientOptions: WebSocketClientOptions = {
        ...this.options,
        onConnect: () => {
          console.log("[WebSocket Integration] Connected successfully");
          this.isInitialized = true;
          this.options.onConnect?.();
        },
        onDisconnect: () => {
          console.log("[WebSocket Integration] Disconnected");
          this.isInitialized = false;
          this.options.onDisconnect?.();
        },
        onError: (error) => {
          console.error("[WebSocket Integration] Error:", error);
          this.options.onError?.(error);
        },
      };

      this.client = createWebSocketClient(clientOptions);
      await this.client.connect();
    } catch (error) {
      console.error("[WebSocket Integration] Failed to connect:", error);
      this.store.connection.onConnectionFailure(
        error instanceof Error ? error.message : "Connection failed"
      );
      throw error;
    }
  }

  // Disconnect from WebSocket
  disconnect(): void {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }

  // Send message with tracking
  send(message: SignalingMessage): void {
    if (!this.client) {
      throw new Error("WebSocket client not initialized");
    }
    this.client.send(message);
  }

  // Convenience methods for common message types
  join(): void {
    if (!this.client) {
      throw new Error("WebSocket client not initialized");
    }
    this.client.join();
  }

  leave(): void {
    if (!this.client) {
      throw new Error("WebSocket client not initialized");
    }
    this.client.leave();
  }

  sendOffer(to: string, offer: RTCSessionDescriptionInit): void {
    if (!this.client) {
      throw new Error("WebSocket client not initialized");
    }
    this.client.sendOffer(to, offer);
  }

  sendAnswer(to: string, answer: RTCSessionDescriptionInit): void {
    if (!this.client) {
      throw new Error("WebSocket client not initialized");
    }
    this.client.sendAnswer(to, answer);
  }

  sendIceCandidate(to: string, candidate: RTCIceCandidateInit): void {
    if (!this.client) {
      throw new Error("WebSocket client not initialized");
    }
    this.client.sendIceCandidate(to, candidate);
  }

  sendChatMessage(content: string, messageType = "text"): void {
    if (!this.client) {
      throw new Error("WebSocket client not initialized");
    }
    this.client.sendChatMessage(content, messageType);
  }

  // Get current connection state
  getConnectionState(): WebSocketState {
    return get(this.store);
  }

  // Check if connected
  isConnected(): boolean {
    return get(this.store).isConnected;
  }

  // Check if connecting
  isConnecting(): boolean {
    return get(this.store).isConnecting;
  }

  // Check if reconnecting
  isReconnecting(): boolean {
    return get(this.store).isReconnecting;
  }

  // Get connection statistics
  getStats(): WebSocketState["stats"] {
    return get(this.store).stats;
  }

  // Get connection health
  getConnectionHealth(): string {
    return get(this.store.connectionHealth);
  }

  // Get success rate
  getConnectionSuccessRate(): number {
    return get(this.store.connectionSuccessRate);
  }

  // Get current latency
  getCurrentLatency(): number {
    return get(this.store.currentLatency);
  }

  // Configure reconnection settings
  configureReconnection(settings: {
    maxAttempts?: number;
    delay?: number;
    enabled?: boolean;
  }): void {
    this.store.config.updateReconnectionSettings(settings);
  }

  // Get event log
  getEventLog(): WebSocketState["eventLog"] {
    return get(this.store).eventLog;
  }

  // Clear event log
  clearEventLog(): void {
    this.store.config.clearEventLog();
  }

  // Reset statistics
  resetStats(): void {
    this.store.config.resetStats();
  }

  // Get client ID
  getClientId(): string {
    return this.client?.getClientId() || get(this.store).clientId || "";
  }

  // Get WebSocket client instance (for advanced usage)
  getClient(): WebSocketClient | null {
    return this.client;
  }

  // Destroy integration
  destroy(): void {
    this.disconnect();

    if (this.unsubscribeFromStore) {
      this.unsubscribeFromStore();
      this.unsubscribeFromStore = null;
    }

    // Reset store state
    this.store.connection.resetConnection();
  }

  // Force reconnection
  async forceReconnect(): Promise<void> {
    console.log("[WebSocket Integration] Force reconnection requested");

    // Reset connection state
    this.store.connection.resetConnection();

    // Disconnect existing client
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }

    // Reconnect
    await this.connect();
  }

  // Enable/disable reconnection
  setReconnectionEnabled(enabled: boolean): void {
    this.configureReconnection({ enabled });
  }

  // Send ping for latency measurement
  ping(): void {
    this.store.messages.onPingSent();

    // Simulate pong after a short delay for testing
    setTimeout(
      () => {
        this.store.messages.onPongReceived();
      },
      Math.random() * 100 + 50
    ); // Random delay between 50-150ms
  }
}

// Factory function for creating WebSocket integration
export function createWebSocketIntegration(
  options: WebSocketIntegrationOptions
): WebSocketIntegration {
  return new WebSocketIntegration(options);
}

// Backward compatibility wrapper
export function createLegacyWebSocketClient(
  options: WebSocketClientOptions
): WebSocketClient {
  console.warn(
    "[WebSocket Integration] Using legacy WebSocket client. " +
      "Consider migrating to createWebSocketIntegration for enhanced features."
  );

  return createWebSocketClient(options);
}
