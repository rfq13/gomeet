/**
 * WebRTC Test Utilities
 *
 * This file contains test utilities for WebRTC functionality,
 * particularly for testing state management and ICE candidate handling.
 */

import { WebRTCManager } from "./webrtc-manager";
import { WebSocketService } from "./websocket-service";

// Mock WebSocket service for testing
export class MockWebSocketService {
  private listeners: Map<string, Function[]> = new Map();
  private state: "connected" | "disconnected" | "connecting" = "disconnected";
  private sentMessages: any[] = [];

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: Function) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  send(message: any) {
    this.sentMessages.push(message);
    console.log("[MockWebSocket] Sent:", message);
  }

  connect() {
    this.state = "connecting";
    setTimeout(() => {
      this.state = "connected";
      this.emit("connected");
    }, 100);
    return Promise.resolve();
  }

  disconnect() {
    this.state = "disconnected";
    this.emit("disconnected");
  }

  getState() {
    return this.state;
  }

  emit(event: string, ...args: any[]) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => callback(...args));
    }
  }

  // Simulate receiving a message
  receiveMessage(message: any) {
    this.emit("message", message);
  }

  // Get all sent messages for testing
  getSentMessages() {
    return [...this.sentMessages];
  }

  // Clear sent messages
  clearSentMessages() {
    this.sentMessages = [];
  }
}

// Test utility functions
export class WebRTCTestUtils {
  /**
   * Create a mock local stream for testing
   */
  static createMockLocalStream(): MediaStream {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = 320;
    canvas.height = 240;

    // Draw something on canvas
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0f0";
    ctx.fillText("Test Stream", 10, 30);

    return canvas.captureStream(30);
  }

  /**
   * Test validateStateForSetRemoteDescription function
   */
  static async testStateValidation() {
    console.log("[WebRTC Test] Testing state validation...");

    const mockWebSocket = new MockWebSocketService();
    const mockStream = this.createMockLocalStream();

    const webrtcManager = new WebRTCManager({
      participantId: "test-participant-1",
      participantName: "Test Participant 1",
      localStream: mockStream,
      webSocketService: mockWebSocket as any,
    });

    // Access private method for testing
    const manager = webrtcManager as any;

    // Test scenarios
    const testCases = [
      {
        name: "Valid state for offer (stable)",
        state: "stable",
        messageType: "offer",
        expected: true,
      },
      {
        name: "Invalid state for offer (have-local-offer)",
        state: "have-local-offer",
        messageType: "offer",
        expected: false,
      },
      {
        name: "Valid state for answer (have-local-offer)",
        state: "have-local-offer",
        messageType: "answer",
        expected: true,
      },
      {
        name: "Invalid state for answer (stable)",
        state: "stable",
        messageType: "answer",
        expected: false,
      },
    ];

    const results = [];

    for (const testCase of testCases) {
      // Create mock peer connection
      const mockPeerConnection = {
        signalingState: testCase.state,
        remoteDescription: testCase.state !== "stable" ? { sdp: "test" } : null,
      } as RTCPeerConnection;

      // Initialize participant state tracking
      manager.initializeParticipantStateTracking("test-participant-2");

      const result = manager.validateStateForSetRemoteDescription(
        mockPeerConnection,
        testCase.messageType,
        "test-participant-2"
      );

      results.push({
        testName: testCase.name,
        expected: testCase.expected,
        actual: result,
        passed: result === testCase.expected,
      });
    }

    console.log("[WebRTC Test] State validation results:", results);
    return results;
  }

  /**
   * Test determineSignalingRole function
   */
  static testSignalingRoleDetermination() {
    console.log("[WebRTC Test] Testing signaling role determination...");

    const mockWebSocket = new MockWebSocketService();
    const mockStream = this.createMockLocalStream();

    const webrtcManager = new WebRTCManager({
      participantId: "participant-a",
      participantName: "Participant A",
      localStream: mockStream,
      webSocketService: mockWebSocket as any,
    });

    const manager = webrtcManager as any;

    const testCases = [
      {
        participantId: "participant-b",
        expected: true, // 'a' < 'b', so we should be offerer
      },
      {
        participantId: "participant-a",
        expected: false, // Same ID, should not be offerer
      },
      {
        participantId: "participant-0",
        expected: false, // '0' < 'a', so we should not be offerer
      },
    ];

    const results = [];

    for (const testCase of testCases) {
      const result = manager.determineSignalingRole(testCase.participantId);
      results.push({
        testName: `Role determination for ${testCase.participantId}`,
        expected: testCase.expected,
        actual: result,
        passed: result === testCase.expected,
      });
    }

    console.log("[WebRTC Test] Signaling role determination results:", results);
    return results;
  }

  /**
   * Test ICE candidate buffering functionality
   */
  static async testIceCandidateBuffering() {
    console.log("[WebRTC Test] Testing ICE candidate buffering...");

    const mockWebSocket = new MockWebSocketService();
    const mockStream = this.createMockLocalStream();

    const webrtcManager = new WebRTCManager({
      participantId: "test-participant-1",
      participantName: "Test Participant 1",
      localStream: mockStream,
      webSocketService: mockWebSocket as any,
    });

    const manager = webrtcManager as any;
    const participantId = "test-participant-2";

    // Test buffering ICE candidates
    const testCandidate = {
      candidate: "candidate:1 1 UDP 2130706431 192.168.1.1 54400 typ host",
      sdpMLineIndex: 0,
      sdpMid: "0",
    };

    // Buffer a candidate
    manager.bufferIceCandidate(participantId, testCandidate);

    // Check if candidate is buffered
    const bufferedCandidates = manager.pendingIceCandidates.get(participantId);
    const bufferTest = {
      testName: "ICE candidate buffering",
      expected: 1,
      actual: bufferedCandidates?.length || 0,
      passed: (bufferedCandidates?.length || 0) === 1,
    };

    console.log("[WebRTC Test] ICE candidate buffering results:", bufferTest);
    return [bufferTest];
  }

  /**
   * Run all WebRTC tests
   */
  static async runAllTests() {
    console.log("[WebRTC Test] Starting comprehensive WebRTC tests...");

    const results = {
      stateValidation: await WebRTCTestUtils.testStateValidation(),
      signalingRole: WebRTCTestUtils.testSignalingRoleDetermination(),
      iceCandidateBuffering: await WebRTCTestUtils.testIceCandidateBuffering(),
    };

    const totalTests = Object.values(results).flat().length;
    const passedTests = Object.values(results)
      .flat()
      .filter((r) => r.passed).length;

    console.log(
      `[WebRTC Test] Test Summary: ${passedTests}/${totalTests} tests passed`
    );

    if (passedTests === totalTests) {
      console.log("[WebRTC Test] ✅ All tests passed!");
    } else {
      console.log("[WebRTC Test] ❌ Some tests failed. Check results above.");
    }

    return results;
  }
}

// Export test runner function
export function runWebRTCTests() {
  return WebRTCTestUtils.runAllTests();
}

// Make available globally for browser console testing
if (typeof window !== "undefined") {
  (window as any).runWebRTCTests = runWebRTCTests;
  (window as any).WebRTCTestUtils = WebRTCTestUtils;
}
