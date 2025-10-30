// Meeting State Store System
//
// This file exports all meeting-related stores and utilities for easy import.

// Core meeting store
export { meetingStore } from "./meeting.store";
export type {
  MeetingState,
  MediaState,
  WebRTCState,
  PublicUserState,
  MeetingUIState,
  MeetingParticipant,
} from "./meeting.store";

// WebRTC synchronization
export { createWebRTCSync, createWebRTCSyncFromStore } from "./webrtc-sync";
export type { WebRTCSync, WebRTCSyncOptions } from "./webrtc-sync";

// Media management
export { createMediaManager, createDefaultMediaManager } from "./media-manager";
export type { MediaManager, MediaManagerOptions } from "./media-manager";

// Integrated meeting manager
// Backward compatibility and integration
export {
  createMeetingCompatAdapter,
  migrateToNewStore,
  createMigrationWrapper,
} from "./meeting-compat";
export type { MeetingCompatAdapter } from "./meeting-compat";

export {
  useMeetingIntegration,
  createMeetingComponentIntegration,
  createTemplateIntegration,
  useCompleteMeetingIntegration,
} from "./meeting-integration";

export {
  createMeetingManager,
  createDefaultMeetingManager,
} from "./meeting-manager";
export type { MeetingManager, MeetingManagerOptions } from "./meeting-manager";

// Re-export auth store for convenience
export { authStore } from "./auth.store";
export type { AuthState } from "$types";

// WebSocket state management
export { webSocketStore } from "./websocket.store";
export type {
  WebSocketState,
  ConnectionStats,
  WebSocketEventLog,
  WebSocketEventType,
  WebSocketConnectionState,
} from "./websocket.store";

// WebSocket integration
export {
  createWebSocketIntegration,
  createLegacyWebSocketClient,
  WebSocketIntegration,
} from "./websocket-integration";
export type { WebSocketIntegrationOptions } from "./websocket-integration";

// Re-export error handling
export { errorStore, logUserAction } from "$lib/errors";
