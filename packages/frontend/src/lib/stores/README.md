# Meeting State Store System

This directory contains the centralized meeting state management system for the GoMeet frontend application. It addresses state fragmentation issues by providing a unified, predictable, and maintainable way to manage meeting-related state.

## 🎯 Problem Solved

Before this implementation, meeting state was scattered across multiple components:

- Meeting details, participants, and UI state in the meeting component
- WebRTC state (peers, connection status) in WebRTC service
- Media state (mic/video controls, streams) in media management
- Public user state in various places

This led to:

- State synchronization issues
- Difficult debugging and testing
- Code duplication
- Inconsistent state updates

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Meeting State Store                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐ │
│  │ Meeting     │ │ WebRTC      │ │ Media                   │ │
│  │ State       │ │ State       │ │ State                   │ │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘ │
│  ┌─────────────┐ ┌─────────────┐                           │
│  │ Public User │ │ UI State    │                           │
│  │ State       │ │             │                           │
│  └─────────────┘ └─────────────┘                           │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
        ┌───────────▼──────────┐ ┌───────▼───────┐
        │   WebRTC Sync        │ │ Media Manager │
        │   (Synchronization)  │ │   (Media)     │
        └──────────────────────┘ └───────────────┘
                    │
            ┌───────▼───────┐
            │ Meeting       │
            │ Manager       │
            │ (Orchestration)│
            └───────────────┘
```

## 📁 File Structure

```
stores/
├── meeting.store.ts          # Core meeting state store
├── webrtc-sync.ts           # WebRTC synchronization layer
├── media-manager.ts         # Media device management
├── meeting-manager.ts       # Integrated meeting manager
├── meeting-compat.ts        # Backward compatibility layer
├── meeting-integration.ts   # Integration helpers
├── index.ts                 # Main exports
└── README.md               # This documentation
```

## 🚀 Quick Start

### Basic Usage

```typescript
import { createDefaultMeetingManager } from "$lib/stores";

// Create meeting manager
const meetingManager = createDefaultMeetingManager("meeting-id");

// Initialize
await meetingManager.initialize();

// Use methods
await meetingManager.toggleMicrophone();
await meetingManager.toggleVideo();
const participants = meetingManager.getAllParticipants();
```

### In Svelte Components

```svelte
<script>
  import { meetingStore } from '$lib/stores';

  // Subscribe to state changes
  $: state = $meetingStore;
  $: participants = $meetingStore.allParticipants;
  $: isMicOn = state.media.isMicOn;

  // Toggle microphone
  async function toggleMic() {
    await meetingStore.media.toggleMic();
  }
</script>

<!-- Use state in template -->
<div class="participant-count">
  {participants.length} participants
</div>

<button on:click={toggleMic}>
  {isMicOn ? 'Mute' : 'Unmute'}
</button>
```

## 📚 Core Components

### 1. Meeting Store (`meeting.store.ts`)

The central state store that manages all meeting-related state:

```typescript
interface MeetingState {
  meeting: Meeting | null;
  meetingId: string | null;
  user: User | null;
  media: MediaState;
  webrtc: WebRTCState;
  publicUser: PublicUserState;
  ui: MeetingUIState;
}
```

**Features:**

- State persistence and rehydration
- Comprehensive logging
- Derived stores for computed values
- Action-based state updates

### 2. WebRTC Sync (`webrtc-sync.ts`)

Synchronization layer between meeting store and WebRTC service:

```typescript
const webRTCSync = createWebRTCSync({
  meetingId: "meeting-id",
  localStream: mediaStream,
  autoConnect: true,
  autoReconnect: true,
});
```

**Features:**

- Automatic reconnection
- Peer state synchronization
- Error handling and recovery
- Connection quality monitoring

### 3. Media Manager (`media-manager.ts`)

Centralized media device management:

```typescript
const mediaManager = createDefaultMediaManager();
const stream = await mediaManager.initialize();
await mediaManager.toggleMicrophone();
```

**Features:**

- Device permission handling
- Audio level monitoring
- Stream management
- Error recovery

### 4. Meeting Manager (`meeting-manager.ts`)

High-level orchestration of all meeting components:

```typescript
const meetingManager = createMeetingManager({
  meetingId: "meeting-id",
  enableAudio: true,
  enableVideo: true,
  autoConnectWebRTC: true,
});

await meetingManager.initialize();
```

**Features:**

- Unified initialization
- Lifecycle management
- Public user support
- Error handling

## 🔄 State Persistence

The meeting store automatically persists important state to localStorage:

```typescript
// Persisted state includes:
{
  publicUser: PublicUserState,
  media: {
    isMicOn: boolean;
    isVideoOn: boolean;
  },
  meetingId: string;
}
```

State is automatically rehydrated on page reload, providing a seamless user experience.

## 🔧 Backward Compatibility

To migrate existing components without breaking changes, use the compatibility layer:

```typescript
import { createMeetingCompatAdapter } from "$lib/stores/meeting-compat";

// Create adapter (same interface as old component)
const adapter = createMeetingCompatAdapter("meeting-id");
await adapter.initialize();

// Use existing methods
adapter.toggleMic();
adapter.toggleVideo();
adapter.hangUp();
```

## 📊 State Monitoring

All state changes are automatically logged:

```typescript
// Automatic logging for:
- User actions (mic toggle, video toggle, etc.)
- State changes (connection status, participant joins/leaves)
- Errors and recovery attempts
- Performance metrics
```

## 🎛️ Derived Stores

Convenient derived stores for common computations:

```typescript
// Check if meeting is active
$isActive = $meetingStore.isMeetingActive;

// Get participant count
$count = $meetingStore.participantCount;

// Get all participants
$participants = $meetingStore.allParticipants;

// Check if user can join
$canJoin = $meetingStore.canJoinMeeting;

// Get connection quality
$quality = $meetingStore.connectionQuality;
```

## 🔌 Integration Examples

### Complete Component Integration

```svelte
<script>
  import { createMeetingComponentIntegration } from '$lib/stores/meeting-integration';

  const {
    state,
    initialize,
    destroy,
    toggleMic,
    toggleVideo
  } = createMeetingComponentIntegration('meeting-id');

  // Initialize on mount
  onMount(() => {
    initialize();
  });

  // Cleanup on destroy
  onDestroy(() => {
    destroy();
  });
</script>

<!-- Use state directly -->
{#if $state.loading}
  <div>Loading...</div>
{:else if $state.meeting}
  <h1>{$state.meeting.title}</h1>
  <button on:click={toggleMic}>
    {$state.isMicOn ? 'Mute' : 'Unmute'}
  </button>
{/if}
```

### Hook-based Integration

```typescript
import { useMeetingIntegration } from "$lib/stores/meeting-integration";

const { state, toggleMic, toggleVideo, hangUp } = useMeetingIntegration();
```

## 🚨 Error Handling

Comprehensive error handling throughout the system:

```typescript
// Automatic error recovery
- Media device permission retries
- WebRTC reconnection attempts
- State restoration on errors

// Error reporting
- Centralized error logging
- User-friendly error messages
- Debug information for developers
```

## 🧪 Testing

The store system is designed for easy testing:

```typescript
import { meetingStore } from "$lib/stores";

// Reset state before each test
meetingStore.reset();

// Test state updates
meetingStore.meeting.setMeeting(mockMeeting);
expect(meetingStore.getState().meeting).toEqual(mockMeeting);

// Test derived stores
expect(get(meetingStore.participantCount)).toBe(1);
```

## 📈 Performance

Optimizations for performance:

- Minimal re-renders with Svelte stores
- Efficient audio level monitoring
- Lazy initialization of components
- Memory leak prevention
- Cleanup on component destruction

## 🔮 Future Enhancements

Planned improvements:

- Offline support with service workers
- Advanced analytics integration
- Real-time collaboration features
- Enhanced accessibility support
- Mobile-specific optimizations

## 🤝 Contributing

When contributing to the meeting store system:

1. Follow the existing patterns and conventions
2. Add comprehensive logging for new features
3. Include backward compatibility considerations
4. Write tests for new functionality
5. Update documentation

## 📞 Support

For questions or issues with the meeting state store:

1. Check the console logs for detailed error information
2. Review the compatibility layer for migration issues
3. Use the debugging tools in the meeting store
4. Consult the API documentation for specific methods
