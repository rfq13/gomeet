// Test script untuk WebRTC cleanup implementation
// Import modules (dalam environment browser)
import { createWebRTCService } from "./src/lib/webrtc-service.js";
import { createWebSocketClient } from "./src/lib/websocket-client.js";

// Mock MediaStream untuk testing
class MockMediaStream {
  constructor() {
    this.tracks = [
      {
        kind: "audio",
        enabled: true,
        stop: () => console.log("Audio track stopped"),
      },
      {
        kind: "video",
        enabled: true,
        stop: () => console.log("Video track stopped"),
      },
    ];
  }

  getTracks() {
    return this.tracks;
  }

  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }

  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
}

// Mock RTCPeerConnection untuk testing
class MockRTCPeerConnection {
  constructor() {
    this.signalingState = "stable";
    this.connectionState = "new";
    this.iceConnectionState = "new";
    this.iceGatheringState = "new";
    this.onicecandidate = null;
    this.onconnectionstatechange = null;
    this.oniceconnectionstatechange = null;
    this.onicegatheringstatechange = null;
    this.ontrack = null;
    this.onsignalingstatechange = null;
    this.ondatachannel = null;
  }

  close() {
    this.signalingState = "closed";
    this.connectionState = "closed";
    this.iceConnectionState = "closed";
    console.log("MockRTCPeerConnection closed");
  }

  addTrack(track, stream) {
    console.log(`Added ${track.kind} track to peer connection`);
  }

  getSenders() {
    return [{ track: this.tracks?.[0] }];
  }

  removeTrack(sender) {
    console.log("Removed track from peer connection");
  }
}

// Test function
async function testWebRTCCleanup() {
  console.log("=== WebRTC Cleanup Test Started ===");

  try {
    // Create mock local stream
    const mockStream = new MockMediaStream();

    // Create WebRTC service
    const webrtcService = createWebRTCService({
      meetingId: "test-meeting",
      localStream: mockStream,
      onError: (error) => console.error("WebRTC Error:", error),
    });

    console.log("✅ WebRTC service created successfully");

    // Test cleanup status
    let status = webrtcService.getCleanupStatus();
    console.log("Initial cleanup status:", status);

    // Simulate some activity
    console.log("Simulating WebRTC activity...");

    // Test destroy method
    console.log("Testing destroy method...");
    webrtcService.destroy();

    // Check status after destroy
    status = webrtcService.getCleanupStatus();
    console.log("Cleanup status after destroy:", status);

    // Test emergency cleanup
    console.log("Testing emergency cleanup...");
    webrtcService.emergencyCleanup();

    console.log("✅ WebRTC cleanup test completed successfully");
  } catch (error) {
    console.error("❌ WebRTC cleanup test failed:", error);
  }
}

async function testWebSocketCleanup() {
  console.log("\n=== WebSocket Cleanup Test Started ===");

  try {
    // Create WebSocket client
    const wsClient = createWebSocketClient({
      meetingId: "test-meeting",
      onError: (error) => console.error("WebSocket Error:", error),
    });

    console.log("✅ WebSocket client created successfully");

    // Test cleanup status
    let status = wsClient.getCleanupStatus();
    console.log("Initial cleanup status:", status);

    // Test destroy method
    console.log("Testing destroy method...");
    wsClient.destroy();

    // Check status after destroy
    status = wsClient.getCleanupStatus();
    console.log("Cleanup status after destroy:", status);

    console.log("✅ WebSocket cleanup test completed successfully");
  } catch (error) {
    console.error("❌ WebSocket cleanup test failed:", error);
  }
}

// Run tests
if (typeof window !== "undefined") {
  // Browser environment
  window.testWebRTCCleanup = testWebRTCCleanup;
  window.testWebSocketCleanup = testWebSocketCleanup;
  console.log(
    "Test functions available in window.testWebRTCCleanup and window.testWebSocketCleanup"
  );
} else {
  // Node.js environment
  console.log("Running tests in Node.js environment...");
  testWebRTCCleanup();
  testWebSocketCleanup();
}

export { testWebRTCCleanup, testWebSocketCleanup };
