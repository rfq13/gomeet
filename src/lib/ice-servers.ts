import { apiClient } from "./api-client";

export interface ICEServer {
  urls: string[];
  username?: string;
  credential?: string;
  credentialType?: "password";
}

export interface TurnCredentials {
  username: string;
  password: string;
  ttl: number;
  urls: string[];
}

export interface ConnectivityResult {
  success: boolean;
  duration: number;
  candidates: number;
  candidateTypes: string[];
  bestCandidate?: RTCIceCandidate;
  connectivity: "direct" | "nat" | "relay" | "failed";
  error?: string;
}

export interface ICEGatheringConfig {
  stunServers: string[];
  turnCredentials?: TurnCredentials;
  enableIPv6: boolean;
  enableRelay: boolean;
  iceTransportPolicy: "all" | "relay";
}

class IceServerManager {
  private credentials: TurnCredentials | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private readonly REFRESH_INTERVAL = 23 * 60 * 60 * 1000; // 23 hours
  private readonly CREDENTIAL_BUFFER = 5 * 60 * 1000; // 5 minutes buffer

  async getIceServers(
    userId?: string,
    meetingId?: string
  ): Promise<ICEServer[]> {
    try {
      // Get TURN credentials if needed
      if (!this.credentials || !this.isCredentialsValid()) {
        await this.refreshCredentials(userId, meetingId);
      }

      const iceServers: ICEServer[] = [];

      // Add STUN servers
      const stunServers = [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
        "stun:stun3.l.google.com:19302",
        "stun:stun4.l.google.com:19302",
        "stun:stun.microsoft.com:3478",
        "stun:stun.services.mozilla.com:3478",
      ];

      stunServers.forEach((url) => {
        iceServers.push({ urls: [url] });
      });

      // Add TURN servers if credentials are available
      if (this.credentials && this.credentials.urls.length > 0) {
        this.credentials.urls.forEach((url) => {
          iceServers.push({
            urls: [url],
            username: this.credentials!.username,
            credential: this.credentials!.password,
            credentialType: "password",
          });
        });
      }

      console.log("[IceServerManager] ICE servers configured:", {
        stunCount: stunServers.length,
        turnCount: this.credentials?.urls.length || 0,
        total: iceServers.length,
      });

      return iceServers;
    } catch (error) {
      console.error("[IceServerManager] Failed to get ICE servers:", error);
      // Return STUN servers as fallback
      return [
        { urls: ["stun:stun.l.google.com:19302"] },
        { urls: ["stun:stun1.l.google.com:19302"] },
      ];
    }
  }

  private async refreshCredentials(
    userId?: string,
    meetingId?: string
  ): Promise<void> {
    try {
      const params = new URLSearchParams();
      if (userId) params.append("user_id", userId);
      if (meetingId) params.append("meeting_id", meetingId);

      const response = await apiClient.request<{
        success: boolean;
        data: TurnCredentials;
        message: string;
      }>("/turn/credentials", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          meeting_id: meetingId,
          ttl: 86400, // 24 hours
        }),
      });

      this.credentials = response.data;

      // Schedule refresh
      this.scheduleRefresh(userId, meetingId);

      console.log("[IceServerManager] TURN credentials refreshed successfully");
    } catch (error) {
      console.error(
        "[IceServerManager] Failed to refresh TURN credentials:",
        error
      );
      throw error;
    }
  }

  private scheduleRefresh(userId?: string, meetingId?: string): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    // Refresh 1 hour before expiration
    const refreshTime = this.REFRESH_INTERVAL - this.CREDENTIAL_BUFFER;

    this.refreshTimer = setTimeout(() => {
      this.refreshCredentials(userId, meetingId);
    }, refreshTime);
  }

  private isCredentialsValid(): boolean {
    if (!this.credentials) {
      return false;
    }

    // Parse timestamp from username (format: timestamp:uuid)
    const parts = this.credentials.username.split(":");
    if (parts.length < 2) {
      return false;
    }

    const timestamp = parseInt(parts[0]);
    if (isNaN(timestamp)) {
      return false;
    }

    const now = Date.now();
    const expires = timestamp * 1000; // Convert to milliseconds

    // Check if credential is still valid with buffer
    return expires - this.CREDENTIAL_BUFFER > now;
  }

  async testConnectivity(
    userId?: string,
    meetingId?: string
  ): Promise<ConnectivityResult> {
    const startTime = Date.now();

    try {
      // Get ICE servers for testing
      const iceServers = await this.getIceServers(userId, meetingId);

      // Create test peer connection
      const peerConnection = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: 10,
        iceTransportPolicy: "all",
      });

      const candidates: RTCIceCandidate[] = [];

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          peerConnection.close();
          reject(new Error("ICE gathering timeout"));
        }, 30000); // 30 seconds timeout

        peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            candidates.push(event.candidate);
          } else {
            // ICE gathering complete
            clearTimeout(timeout);
            const endTime = Date.now();
            const duration = endTime - startTime;

            // Analyze candidates
            const analysis = this.analyzeCandidates(candidates);
            peerConnection.close();

            resolve({
              success: true,
              duration,
              candidates: candidates.length,
              candidateTypes: analysis.types,
              bestCandidate: analysis.best || undefined,
              connectivity: analysis.connectivity,
            });
          }
        };

        peerConnection.onicegatheringstatechange = () => {
          if (peerConnection.iceGatheringState === "complete") {
            clearTimeout(timeout);
            const endTime = Date.now();
            const duration = endTime - startTime;

            // Analyze candidates
            const analysis = this.analyzeCandidates(candidates);
            peerConnection.close();

            resolve({
              success: true,
              duration,
              candidates: candidates.length,
              candidateTypes: analysis.types,
              bestCandidate: analysis.best || undefined,
              connectivity: analysis.connectivity,
            });
          }
        };

        peerConnection.oniceconnectionstatechange = () => {
          if (peerConnection.iceConnectionState === "failed") {
            clearTimeout(timeout);
            peerConnection.close();
            resolve({
              success: false,
              duration: Date.now() - startTime,
              candidates: candidates.length,
              candidateTypes: [],
              connectivity: "failed",
              error: "ICE connection failed",
            });
          }
        };

        // Start ICE gathering
        peerConnection
          .createOffer()
          .then((offer) => {
            return peerConnection.setLocalDescription(offer);
          })
          .catch((error) => {
            clearTimeout(timeout);
            peerConnection.close();
            reject(error);
          });
      });
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        candidates: 0,
        candidateTypes: [],
        error: error instanceof Error ? error.message : "Unknown error",
        connectivity: "failed",
      };
    }
  }

  private analyzeCandidates(candidates: RTCIceCandidate[]): {
    types: string[];
    best: RTCIceCandidate | null;
    connectivity: "direct" | "nat" | "relay" | "failed";
  } {
    const types = new Set<string>();
    let bestCandidate: RTCIceCandidate | null = null;
    let connectivity: "direct" | "nat" | "relay" | "failed" = "failed";

    for (const candidate of candidates) {
      if (candidate.type) {
        types.add(candidate.type);
      }

      // Determine best candidate based on type and priority
      if (!bestCandidate || this.isBetterCandidate(candidate, bestCandidate)) {
        bestCandidate = candidate;
      }
    }

    // Determine connectivity type
    if (types.has("host")) {
      connectivity = "direct";
    } else if (types.has("srflx")) {
      connectivity = "nat";
    } else if (types.has("relay")) {
      connectivity = "relay";
    }

    return {
      types: Array.from(types),
      best: bestCandidate,
      connectivity,
    };
  }

  private isBetterCandidate(
    candidate1: RTCIceCandidate,
    candidate2: RTCIceCandidate
  ): boolean {
    const priority1 = candidate1.priority || 0;
    const priority2 = candidate2.priority || 0;

    // Higher priority is better
    if (priority1 !== priority2) {
      return priority1 > priority2;
    }

    // Prefer host over srflx over relay
    const typeOrder = { host: 3, srflx: 2, relay: 1 };
    const type1Order =
      typeOrder[candidate1.type as keyof typeof typeOrder] || 0;
    const type2Order =
      typeOrder[candidate2.type as keyof typeof typeOrder] || 0;

    return type1Order > type2Order;
  }

  async validateCredentials(
    username: string,
    password: string
  ): Promise<boolean> {
    try {
      const response = await apiClient.request<{
        success: boolean;
        data: { valid: boolean };
        message: string;
      }>(
        `/api/v1/turn/validate?username=${encodeURIComponent(
          username
        )}&password=${encodeURIComponent(password)}`
      );

      return response.data.valid;
    } catch (error) {
      console.error(
        "[IceServerManager] Failed to validate credentials:",
        error
      );
      return false;
    }
  }

  async logUsage(
    username: string,
    action: "allocate" | "refresh" | "deallocate" | "connect" | "disconnect",
    bytesTransferred?: number
  ): Promise<void> {
    try {
      await apiClient.request("/api/v1/turn/log-usage", {
        method: "POST",
        body: JSON.stringify({
          username,
          action,
          bytes_transferred: bytesTransferred || 0,
        }),
      });
    } catch (error) {
      console.error("[IceServerManager] Failed to log usage:", error);
      // Don't throw error as this is non-critical
    }
  }

  async getServerInfo(): Promise<any> {
    try {
      const response = await apiClient.request<{
        success: boolean;
        data: any;
        message: string;
      }>("/api/v1/turn/server-info");

      return response.data;
    } catch (error) {
      console.error("[IceServerManager] Failed to get server info:", error);
      throw error;
    }
  }

  cleanup(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.credentials = null;
  }

  // Utility methods for WebRTC integration
  createPeerConnectionWithIceServers(
    configuration?: RTCConfiguration,
    userId?: string,
    meetingId?: string
  ): Promise<RTCPeerConnection> {
    return this.getIceServers(userId, meetingId).then((iceServers) => {
      const rtcConfiguration: RTCConfiguration = {
        ...configuration,
        iceServers,
        iceCandidatePoolSize: 10,
        iceTransportPolicy: configuration?.iceTransportPolicy || "all",
      };

      const peerConnection = new RTCPeerConnection(rtcConfiguration);

      // Log connection state changes
      peerConnection.oniceconnectionstatechange = () => {
        console.log(
          "[IceServerManager] ICE connection state:",
          peerConnection.iceConnectionState
        );

        // Log usage based on connection state
        if (this.credentials) {
          switch (peerConnection.iceConnectionState) {
            case "connected":
            case "completed":
              this.logUsage(this.credentials.username, "connect");
              break;
            case "disconnected":
            case "failed":
            case "closed":
              this.logUsage(this.credentials.username, "disconnect");
              break;
          }
        }
      };

      return peerConnection;
    });
  }
}

// Singleton instance
export const iceServerManager = new IceServerManager();

// Export class for testing or multiple instances
export { IceServerManager };

// Utility function to get ICE servers
export const getIceServers = (
  userId?: string,
  meetingId?: string
): Promise<ICEServer[]> => {
  return iceServerManager.getIceServers(userId, meetingId);
};

// Utility function to test connectivity
export const testTurnConnectivity = (
  userId?: string,
  meetingId?: string
): Promise<ConnectivityResult> => {
  return iceServerManager.testConnectivity(userId, meetingId);
};
