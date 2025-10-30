import type { WebRTCContext, WebRTCStats } from "./types";
import { StructuredLogger } from "./structured-logger";

interface WebRTCEventContext {
  meetingId?: string;
  peerId?: string;
  connectionId?: string;
  eventType: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

interface WebRTCLoggerConfig {
  logAllEvents: boolean;
  logStatsInterval: number; // ms
  logConnectionStateChanges: boolean;
  logSignalingEvents: boolean;
  logMediaEvents: boolean;
  logQualityMetrics: boolean;
  qualityThresholds: {
    packetLoss: number;
    jitter: number;
    roundTripTime: number;
  };
}

export class WebRTCLogger {
  private config: WebRTCLoggerConfig;
  private statsIntervals: Map<string, NodeJS.Timeout> = new Map();
  private connectionStates: Map<string, string> = new Map();

  constructor(
    private structuredLogger: StructuredLogger,
    config: Partial<WebRTCLoggerConfig> = {}
  ) {
    this.config = {
      logAllEvents: true,
      logStatsInterval: 5000, // 5 seconds
      logConnectionStateChanges: true,
      logSignalingEvents: true,
      logMediaEvents: true,
      logQualityMetrics: true,
      qualityThresholds: {
        packetLoss: 0.05, // 5%
        jitter: 30, // ms
        roundTripTime: 150, // ms
      },
      ...config,
    };
  }

  // Connection lifecycle logging
  logConnectionCreated(
    connectionId: string,
    meetingId?: string,
    peerId?: string
  ): void {
    const context: WebRTCEventContext = {
      meetingId,
      peerId,
      connectionId,
      eventType: "connection_created",
      timestamp: new Date().toISOString(),
    };

    this.logWebRTCEvent("WebRTC connection created", context);
    this.connectionStates.set(connectionId, "new");
  }

  logConnectionStateChange(
    connectionId: string,
    oldState: string,
    newState: string,
    meetingId?: string,
    peerId?: string
  ): void {
    if (!this.config.logConnectionStateChanges) {
      return;
    }

    this.connectionStates.set(connectionId, newState);

    const context: WebRTCEventContext = {
      meetingId,
      peerId,
      connectionId,
      eventType: "connection_state_change",
      timestamp: new Date().toISOString(),
      metadata: {
        oldState,
        newState,
      },
    };

    const level = this.getStateChangeLogLevel(newState);
    this.logWebRTCEvent(
      `WebRTC connection state: ${oldState} → ${newState}`,
      context,
      level
    );
  }

  logICEConnectionStateChange(
    connectionId: string,
    state: string,
    meetingId?: string,
    peerId?: string
  ): void {
    const context: WebRTCEventContext = {
      meetingId,
      peerId,
      connectionId,
      eventType: "ice_connection_state_change",
      timestamp: new Date().toISOString(),
      metadata: {
        iceState: state,
      },
    };

    const level =
      state === "failed" || state === "disconnected" ? "error" : "info";
    this.logWebRTCEvent(`ICE connection state: ${state}`, context, level);
  }

  logSignalingEvent(
    connectionId: string,
    eventType: string,
    data?: any,
    meetingId?: string,
    peerId?: string
  ): void {
    if (!this.config.logSignalingEvents) {
      return;
    }

    const context: WebRTCEventContext = {
      meetingId,
      peerId,
      connectionId,
      eventType: `signaling_${eventType}`,
      timestamp: new Date().toISOString(),
      metadata: {
        signalingType: eventType,
        data: this.sanitizeSignalingData(data),
      },
    };

    this.logWebRTCEvent(`WebRTC signaling: ${eventType}`, context);
  }

  // Media logging
  logMediaTrackAdded(
    connectionId: string,
    trackKind: "audio" | "video",
    trackId: string,
    meetingId?: string,
    peerId?: string
  ): void {
    if (!this.config.logMediaEvents) {
      return;
    }

    const context: WebRTCEventContext = {
      meetingId,
      peerId,
      connectionId,
      eventType: "media_track_added",
      timestamp: new Date().toISOString(),
      metadata: {
        trackKind,
        trackId,
      },
    };

    this.logWebRTCEvent(`Media track added: ${trackKind}`, context);
  }

  logMediaTrackRemoved(
    connectionId: string,
    trackKind: "audio" | "video",
    trackId: string,
    meetingId?: string,
    peerId?: string
  ): void {
    if (!this.config.logMediaEvents) {
      return;
    }

    const context: WebRTCEventContext = {
      meetingId,
      peerId,
      connectionId,
      eventType: "media_track_removed",
      timestamp: new Date().toISOString(),
      metadata: {
        trackKind,
        trackId,
      },
    };

    this.logWebRTCEvent(`Media track removed: ${trackKind}`, context);
  }

  logMediaStateChange(
    connectionId: string,
    type: "audio" | "video",
    enabled: boolean,
    meetingId?: string,
    peerId?: string
  ): void {
    const context: WebRTCEventContext = {
      meetingId,
      peerId,
      connectionId,
      eventType: "media_state_change",
      timestamp: new Date().toISOString(),
      metadata: {
        mediaType: type,
        enabled,
      },
    };

    this.logWebRTCEvent(
      `Media ${type} ${enabled ? "enabled" : "disabled"}`,
      context
    );
  }

  // Statistics and quality monitoring
  startStatsMonitoring(
    connectionId: string,
    peerConnection: RTCPeerConnection,
    meetingId?: string,
    peerId?: string
  ): void {
    if (this.statsIntervals.has(connectionId)) {
      this.stopStatsMonitoring(connectionId);
    }

    const interval = setInterval(async () => {
      try {
        const stats = await peerConnection.getStats();
        this.processStatsReport(connectionId, stats, meetingId, peerId);
      } catch (error) {
        this.logWebRTCError(
          "Failed to get WebRTC stats",
          connectionId,
          error as Error,
          meetingId,
          peerId
        );
      }
    }, this.config.logStatsInterval);

    this.statsIntervals.set(connectionId, interval);
  }

  stopStatsMonitoring(connectionId: string): void {
    const interval = this.statsIntervals.get(connectionId);
    if (interval) {
      clearInterval(interval);
      this.statsIntervals.delete(connectionId);
    }
  }

  private processStatsReport(
    connectionId: string,
    statsReport: RTCStatsReport,
    meetingId?: string,
    peerId?: string
  ): void {
    const stats: Partial<WebRTCStats> = {};
    let hasQualityIssues = false;

    statsReport.forEach((report) => {
      switch (report.type) {
        case "inbound-rtp":
          if (report.kind === "video") {
            stats.videoWidth = (report as any).frameWidth;
            stats.videoHeight = (report as any).frameHeight;
            stats.frameRate = (report as any).framesPerSecond;
          }
          if (report.kind === "audio") {
            stats.audioLevel = (report as any).audioLevel;
          }
          stats.bytesReceived =
            (stats.bytesReceived || 0) + (report as any).bytesReceived;
          stats.packetsLost = (report as any).packetsLost;
          break;

        case "outbound-rtp":
          stats.bytesSent = (stats.bytesSent || 0) + (report as any).bytesSent;
          break;

        case "remote-inbound-rtp":
          stats.roundTripTime = (report as any).roundTripTime;
          stats.jitter = (report as any).jitter;
          break;

        case "transport":
          // Can get connection state info here
          break;
      }
    });

    // Check quality thresholds
    if (this.config.logQualityMetrics) {
      if (
        stats.packetsLost &&
        stats.packetsLost > this.config.qualityThresholds.packetLoss
      ) {
        hasQualityIssues = true;
        this.logQualityIssue(
          connectionId,
          "packet_loss",
          stats.packetsLost,
          meetingId,
          peerId
        );
      }

      if (stats.jitter && stats.jitter > this.config.qualityThresholds.jitter) {
        hasQualityIssues = true;
        this.logQualityIssue(
          connectionId,
          "jitter",
          stats.jitter,
          meetingId,
          peerId
        );
      }

      if (
        stats.roundTripTime &&
        stats.roundTripTime > this.config.qualityThresholds.roundTripTime
      ) {
        hasQualityIssues = true;
        this.logQualityIssue(
          connectionId,
          "rtt",
          stats.roundTripTime,
          meetingId,
          peerId
        );
      }
    }

    const context: WebRTCEventContext = {
      meetingId,
      peerId,
      connectionId,
      eventType: "stats_report",
      timestamp: new Date().toISOString(),
      metadata: {
        stats,
        hasQualityIssues,
      },
    };

    const level = hasQualityIssues ? "warn" : "debug";
    this.logWebRTCEvent("WebRTC stats report", context, level);
  }

  private logQualityIssue(
    connectionId: string,
    issueType: string,
    value: number,
    meetingId?: string,
    peerId?: string
  ): void {
    const context: WebRTCEventContext = {
      meetingId,
      peerId,
      connectionId,
      eventType: "quality_issue",
      timestamp: new Date().toISOString(),
      metadata: {
        issueType,
        value,
        threshold:
          this.config.qualityThresholds[
            issueType as keyof typeof this.config.qualityThresholds
          ],
      },
    };

    this.logWebRTCEvent(
      `Quality issue detected: ${issueType}`,
      context,
      "warn"
    );
  }

  // Error logging
  logWebRTCError(
    message: string,
    connectionId: string,
    error: Error,
    meetingId?: string,
    peerId?: string
  ): void {
    const context: WebRTCEventContext = {
      meetingId,
      peerId,
      connectionId,
      eventType: "error",
      timestamp: new Date().toISOString(),
      metadata: {
        errorMessage: error.message,
        errorStack: error.stack,
        errorName: error.name,
      },
    };

    this.logWebRTCEvent(`WebRTC Error: ${message}`, context, "error");
  }

  // Utility methods
  private logWebRTCEvent(
    message: string,
    context: WebRTCEventContext,
    level: "debug" | "info" | "warn" | "error" = "info"
  ): void {
    if (!this.config.logAllEvents && level === "debug") {
      return;
    }

    const logEntry = {
      level,
      message,
      category: "webrtc" as const,
      operation: context.eventType,
      timestamp: context.timestamp,
      context: {
        ...context,
        sessionId: this.structuredLogger.getContext("sessionId"),
        userId: this.structuredLogger.getContext("userId"),
        userAgent: navigator.userAgent,
      },
    };

    this.structuredLogger[level](message, logEntry);
  }

  private getStateChangeLogLevel(
    state: string
  ): "debug" | "info" | "warn" | "error" {
    switch (state) {
      case "failed":
      case "disconnected":
      case "closed":
        return "error";
      case "connecting":
      case "connected":
        return "info";
      default:
        return "debug";
    }
  }

  private sanitizeSignalingData(data: any): any {
    if (!data) return data;

    // Remove sensitive information from signaling data
    const sanitized = { ...data };

    // Remove ICE candidates that might reveal IP addresses in production
    if (process.env.NODE_ENV === "production") {
      if (sanitized.candidate) {
        sanitized.candidate = "[REDACTED]";
      }
    }

    return sanitized;
  }

  // Cleanup
  destroy(): void {
    // Stop all stats monitoring
    this.statsIntervals.forEach((interval) => {
      clearInterval(interval);
    });
    this.statsIntervals.clear();
    this.connectionStates.clear();
  }

  // Get connection info for debugging
  getConnectionInfo(connectionId: string): {
    state: string | undefined;
    isMonitoring: boolean;
  } {
    return {
      state: this.connectionStates.get(connectionId),
      isMonitoring: this.statsIntervals.has(connectionId),
    };
  }

  // Log meeting lifecycle events
  logMeetingJoined(meetingId: string, userId?: string): void {
    const context: WebRTCEventContext = {
      meetingId,
      eventType: "meeting_joined",
      timestamp: new Date().toISOString(),
      metadata: {
        userId,
      },
    };

    this.logWebRTCEvent(`Meeting joined: ${meetingId}`, context);
  }

  logMeetingLeft(meetingId: string, reason?: string): void {
    const context: WebRTCEventContext = {
      meetingId,
      eventType: "meeting_left",
      timestamp: new Date().toISOString(),
      metadata: {
        reason,
      },
    };

    this.logWebRTCEvent(`Meeting left: ${meetingId}`, context);
  }
}
