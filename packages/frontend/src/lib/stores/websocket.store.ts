import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import { errorLogger } from "$lib/errors/logger";

// WebSocket connection states
export type WebSocketConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closing"
  | "error";

// WebSocket event types for logging
export type WebSocketEventType =
  | "connection_attempt"
  | "connection_success"
  | "connection_failed"
  | "connection_lost"
  | "reconnection_attempt"
  | "reconnection_success"
  | "reconnection_failed"
  | "message_sent"
  | "message_received"
  | "error";

// Connection statistics
export interface ConnectionStats {
  totalAttempts: number;
  successfulConnections: number;
  failedConnections: number;
  reconnectionAttempts: number;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  averageLatency: number;
  totalMessagesSent: number;
  totalMessagesReceived: number;
  connectionDuration: number; // in milliseconds
}

// WebSocket event log entry
export interface WebSocketEventLog {
  id: string;
  timestamp: string;
  eventType: WebSocketEventType;
  connectionState: WebSocketConnectionState;
  details?: Record<string, any>;
  error?: string;
  latency?: number;
}

// WebSocket state interface
export interface WebSocketState {
  // Connection state
  connectionState: WebSocketConnectionState;
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;

  // Connection details
  meetingId: string | null;
  clientId: string | null;
  url: string | null;

  // Error handling
  lastError: string | null;
  errorCount: number;

  // Reconnection settings
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  reconnectDelay: number;
  isReconnectionEnabled: boolean;

  // Statistics
  stats: ConnectionStats;

  // Event logging
  eventLog: WebSocketEventLog[];
  maxEventLogSize: number;

  // Performance monitoring
  connectionStartTime: number | null;
  lastPingTime: number | null;
  lastPongTime: number | null;
}

// Initial state
const createInitialWebSocketState = (): WebSocketState => ({
  connectionState: "disconnected",
  isConnected: false,
  isConnecting: false,
  isReconnecting: false,
  meetingId: null,
  clientId: null,
  url: null,
  lastError: null,
  errorCount: 0,
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  isReconnectionEnabled: true,
  stats: {
    totalAttempts: 0,
    successfulConnections: 0,
    failedConnections: 0,
    reconnectionAttempts: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    averageLatency: 0,
    totalMessagesSent: 0,
    totalMessagesReceived: 0,
    connectionDuration: 0,
  },
  eventLog: [],
  maxEventLogSize: 100,
  connectionStartTime: null,
  lastPingTime: null,
  lastPongTime: null,
});

// Create WebSocket store
function createWebSocketStore() {
  const initialState = createInitialWebSocketState();
  const store = writable<WebSocketState>(initialState);

  // Persistence key for settings
  const SETTINGS_KEY = "gomeet_websocket_settings";

  // Logging utility
  const logEvent = (
    eventType: WebSocketEventType,
    details?: Record<string, any>,
    error?: string
  ) => {
    const currentState = get(store);
    const logEntry: WebSocketEventLog = {
      id: `ws_log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      eventType,
      connectionState: currentState.connectionState,
      details,
      error,
    };

    // Log to structured logger
    errorLogger.info(`WebSocket Event: ${eventType}`, {
      eventType,
      connectionState: currentState.connectionState,
      meetingId: currentState.meetingId,
      clientId: currentState.clientId,
      ...details,
      ...(error && { error }),
    });

    // Update event log
    store.update((current) => {
      const newEventLog = [...current.eventLog, logEntry];

      // Maintain max log size
      if (newEventLog.length > current.maxEventLogSize) {
        newEventLog.splice(0, newEventLog.length - current.maxEventLogSize);
      }

      return {
        ...current,
        eventLog: newEventLog,
      };
    });

    return logEntry;
  };

  // Calculate exponential backoff delay
  const calculateReconnectDelay = (attempt: number): number => {
    const baseDelay = get(store).reconnectDelay;
    const maxDelay = 30000; // 30 seconds max
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * delay;
    return Math.floor(delay + jitter);
  };

  // Update connection statistics
  const updateStats = (updates: Partial<ConnectionStats>) => {
    store.update((current) => ({
      ...current,
      stats: {
        ...current.stats,
        ...updates,
      },
    }));
  };

  // Connection state actions
  const connectionActions = {
    // Set connection state
    setConnectionState: (state: WebSocketConnectionState) => {
      const currentState = get(store);
      const previousState = currentState.connectionState;

      if (previousState !== state) {
        logEvent("connection_attempt" as WebSocketEventType, {
          previousState,
          newState: state,
        });

        store.update((current) => ({
          ...current,
          connectionState: state,
          isConnected: state === "connected",
          isConnecting: state === "connecting",
          isReconnecting: state === "reconnecting",
        }));

        // Update connection duration tracking
        if (state === "connected" && previousState !== "connected") {
          const now = Date.now();
          store.update((current) => ({
            ...current,
            connectionStartTime: now,
            stats: {
              ...current.stats,
              lastConnectedAt: new Date(now).toISOString(),
              successfulConnections: current.stats.successfulConnections + 1,
            },
          }));
        } else if (state === "disconnected" && previousState === "connected") {
          const now = Date.now();
          const connectionDuration = currentState.connectionStartTime
            ? now - currentState.connectionStartTime
            : 0;

          store.update((current) => ({
            ...current,
            connectionStartTime: null,
            stats: {
              ...current.stats,
              lastDisconnectedAt: new Date(now).toISOString(),
              connectionDuration:
                current.stats.connectionDuration + connectionDuration,
            },
          }));
        }
      }
    },

    // Set connection details
    setConnectionDetails: (
      meetingId: string,
      clientId: string,
      url: string
    ) => {
      logEvent("connection_attempt", {
        meetingId,
        clientId,
        url,
      });

      store.update((current) => ({
        ...current,
        meetingId,
        clientId,
        url,
        stats: {
          ...current.stats,
          totalAttempts: current.stats.totalAttempts + 1,
        },
      }));
    },

    // Handle connection success
    onConnectionSuccess: () => {
      logEvent("connection_success");

      store.update((current) => ({
        ...current,
        connectionState: "connected",
        isConnected: true,
        isConnecting: false,
        isReconnecting: false,
        reconnectAttempts: 0,
        lastError: null,
        errorCount: 0,
        connectionStartTime: Date.now(),
        stats: {
          ...current.stats,
          successfulConnections: current.stats.successfulConnections + 1,
          lastConnectedAt: new Date().toISOString(),
        },
      }));
    },

    // Handle connection failure
    onConnectionFailure: (error: string) => {
      logEvent("connection_failed", { error });

      store.update((current) => ({
        ...current,
        connectionState: "error",
        isConnected: false,
        isConnecting: false,
        isReconnecting: false,
        lastError: error,
        errorCount: current.errorCount + 1,
        stats: {
          ...current.stats,
          failedConnections: current.stats.failedConnections + 1,
        },
      }));
    },

    // Handle connection loss
    onConnectionLost: (reason?: string) => {
      logEvent("connection_lost", { reason });

      const connectionDuration = get(store).connectionStartTime
        ? Date.now() - get(store).connectionStartTime
        : 0;

      store.update((current) => ({
        ...current,
        connectionState: "disconnected",
        isConnected: false,
        isConnecting: false,
        isReconnecting: false,
        connectionStartTime: null,
        stats: {
          ...current.stats,
          lastDisconnectedAt: new Date().toISOString(),
          connectionDuration:
            current.stats.connectionDuration + connectionDuration,
        },
      }));
    },

    // Start reconnection
    startReconnection: () => {
      const currentState = get(store);

      if (!currentState.isReconnectionEnabled) {
        return;
      }

      const nextAttempt = currentState.reconnectAttempts + 1;

      if (nextAttempt > currentState.maxReconnectAttempts) {
        logEvent("reconnection_failed", {
          maxAttemptsReached: true,
          totalAttempts: currentState.reconnectAttempts,
        });
        return;
      }

      const delay = calculateReconnectDelay(nextAttempt);

      logEvent("reconnection_attempt", {
        attempt: nextAttempt,
        maxAttempts: currentState.maxReconnectAttempts,
        delay,
      });

      store.update((current) => ({
        ...current,
        connectionState: "reconnecting",
        isReconnecting: true,
        reconnectAttempts: nextAttempt,
        stats: {
          ...current.stats,
          reconnectionAttempts: current.stats.reconnectionAttempts + 1,
        },
      }));

      return delay;
    },

    // Handle reconnection success
    onReconnectionSuccess: () => {
      logEvent("reconnection_success", {
        attempt: get(store).reconnectAttempts,
      });

      store.update((current) => ({
        ...current,
        connectionState: "connected",
        isConnected: true,
        isConnecting: false,
        isReconnecting: false,
        reconnectAttempts: 0,
        lastError: null,
        connectionStartTime: Date.now(),
        stats: {
          ...current.stats,
          successfulConnections: current.stats.successfulConnections + 1,
          lastConnectedAt: new Date().toISOString(),
        },
      }));
    },

    // Handle reconnection failure
    onReconnectionFailure: (error: string) => {
      logEvent("reconnection_failed", {
        attempt: get(store).reconnectAttempts,
        error,
      });

      store.update((current) => ({
        ...current,
        connectionState: "error",
        isConnected: false,
        isConnecting: false,
        isReconnecting: false,
        lastError: error,
        errorCount: current.errorCount + 1,
      }));
    },

    // Reset connection state
    resetConnection: () => {
      logEvent("connection_attempt", { action: "reset" });

      store.update((current) => ({
        ...current,
        connectionState: "disconnected",
        isConnected: false,
        isConnecting: false,
        isReconnecting: false,
        reconnectAttempts: 0,
        lastError: null,
        errorCount: 0,
        connectionStartTime: null,
        meetingId: null,
        clientId: null,
        url: null,
      }));
    },
  };

  // Message tracking actions
  const messageActions = {
    // Track sent message
    onMessageSent: (messageType: string, size?: number) => {
      logEvent("message_sent", {
        messageType,
        size,
      });

      store.update((current) => ({
        ...current,
        stats: {
          ...current.stats,
          totalMessagesSent: current.stats.totalMessagesSent + 1,
        },
      }));
    },

    // Track received message
    onMessageReceived: (
      messageType: string,
      size?: number,
      latency?: number
    ) => {
      logEvent("message_received", {
        messageType,
        size,
        latency,
      });

      store.update((current) => {
        const newTotalMessages = current.stats.totalMessagesReceived + 1;
        const currentAverageLatency = current.stats.averageLatency;
        const newAverageLatency = latency
          ? (currentAverageLatency * (newTotalMessages - 1) + latency) /
            newTotalMessages
          : currentAverageLatency;

        return {
          ...current,
          stats: {
            ...current.stats,
            totalMessagesReceived: newTotalMessages,
            averageLatency: newAverageLatency,
          },
        };
      });
    },

    // Track ping/pong for latency measurement
    onPingSent: () => {
      store.update((current) => ({
        ...current,
        lastPingTime: Date.now(),
      }));
    },

    onPongReceived: () => {
      const currentState = get(store);
      if (currentState.lastPingTime) {
        const latency = Date.now() - currentState.lastPingTime;

        store.update((current) => ({
          ...current,
          lastPongTime: Date.now(),
          lastPingTime: null,
          stats: {
            ...current.stats,
            averageLatency: latency, // Update with latest latency
          },
        }));

        return latency;
      }
      return null;
    },
  };

  // Configuration actions
  const configActions = {
    // Update reconnection settings
    updateReconnectionSettings: (settings: {
      maxAttempts?: number;
      delay?: number;
      enabled?: boolean;
    }) => {
      store.update((current) => ({
        ...current,
        maxReconnectAttempts:
          settings.maxAttempts ?? current.maxReconnectAttempts,
        reconnectDelay: settings.delay ?? current.reconnectDelay,
        isReconnectionEnabled:
          settings.enabled ?? current.isReconnectionEnabled,
      }));

      // Persist settings
      if (browser) {
        try {
          const currentSettings = {
            maxReconnectAttempts: get(store).maxReconnectAttempts,
            reconnectDelay: get(store).reconnectDelay,
            isReconnectionEnabled: get(store).isReconnectionEnabled,
          };
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));
        } catch (error) {
          console.error("Failed to persist WebSocket settings:", error);
        }
      }
    },

    // Load persisted settings
    loadPersistedSettings: () => {
      if (!browser) return;

      try {
        const persisted = localStorage.getItem(SETTINGS_KEY);
        if (persisted) {
          const settings = JSON.parse(persisted);
          store.update((current) => ({
            ...current,
            maxReconnectAttempts:
              settings.maxReconnectAttempts ?? current.maxReconnectAttempts,
            reconnectDelay: settings.reconnectDelay ?? current.reconnectDelay,
            isReconnectionEnabled:
              settings.isReconnectionEnabled ?? current.isReconnectionEnabled,
          }));
        }
      } catch (error) {
        console.error("Failed to load persisted WebSocket settings:", error);
      }
    },

    // Clear event log
    clearEventLog: () => {
      store.update((current) => ({
        ...current,
        eventLog: [],
      }));
    },

    // Reset statistics
    resetStats: () => {
      store.update((current) => ({
        ...current,
        stats: createInitialWebSocketState().stats,
      }));
    },
  };

  // Derived stores
  const derivedStores = {
    // Connection health indicator
    connectionHealth: derived(store, ($store) => {
      if ($store.connectionState === "connected") return "healthy";
      if ($store.connectionState === "reconnecting") return "recovering";
      if ($store.connectionState === "error") return "unhealthy";
      return "disconnected";
    }),

    // Success rate
    connectionSuccessRate: derived(store, ($store) => {
      const total = $store.stats.totalAttempts;
      if (total === 0) return 100;
      return Math.round(($store.stats.successfulConnections / total) * 100);
    }),

    // Current latency
    currentLatency: derived(store, ($store) => {
      return $store.lastPingTime && $store.lastPongTime
        ? $store.lastPongTime - $store.lastPingTime
        : $store.stats.averageLatency;
    }),

    // Time since last connection
    timeSinceLastConnection: derived(store, ($store) => {
      if (!$store.stats.lastConnectedAt) return null;
      return Date.now() - new Date($store.stats.lastConnectedAt).getTime();
    }),
  };

  // Initialize store
  const initialize = () => {
    configActions.loadPersistedSettings();
    logEvent("connection_attempt", { action: "store_initialized" });
  };

  return {
    subscribe: store.subscribe,

    // Connection actions
    connection: connectionActions,

    // Message actions
    messages: messageActions,

    // Configuration actions
    config: configActions,

    // Derived stores
    connectionHealth: derivedStores.connectionHealth,
    connectionSuccessRate: derivedStores.connectionSuccessRate,
    currentLatency: derivedStores.currentLatency,
    timeSinceLastConnection: derivedStores.timeSinceLastConnection,

    // Utility methods
    initialize,
    reset: () => store.set(createInitialWebSocketState()),
    getState: () => get(store),
  };
}

// Export singleton instance
export const webSocketStore = createWebSocketStore();
