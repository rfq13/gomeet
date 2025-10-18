import { apiClient } from "./api-client";

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  description: string;
  updated_at: string;
}

export interface FeatureFlagConfig {
  use_livekit_sfu: boolean;
  use_webrtc_mesh: boolean;
  enable_sfu_logs: boolean;
}

export interface MeetingFlagRequest {
  meeting_id: string;
  enabled: boolean;
}

export interface MigrationStats {
  livekit_meeting_count: number;
  global_livekit_enabled: boolean;
  global_mesh_enabled: boolean;
  sfu_logs_enabled: boolean;
  migration_phase: "mesh_only" | "parallel_testing" | "sfu_only" | "unknown";
  updated_at: string;
}

export interface MigrationPhase {
  phase: "mesh_only" | "parallel_testing" | "sfu_only" | "unknown";
  description: string;
  recommendations: string[];
  config: FeatureFlagConfig;
}

export interface SetFlagRequest {
  flag_name: string;
  enabled: boolean;
}

export interface ArchitectureInfo {
  meeting_id: string;
  should_use: boolean;
  architecture: "SFU (LiveKit)" | "Mesh (WebRTC)";
}

class FeatureFlagService {
  private baseUrl = "/api/v1/feature-flags";

  // Get current feature configuration
  async getFeatureConfig(): Promise<FeatureFlagConfig> {
    const response = await apiClient.request<{
      success: boolean;
      data: FeatureFlagConfig;
    }>(`${this.baseUrl}/config`);
    return response.data;
  }

  // Get all feature flags with their status
  async getAllFlags(): Promise<Record<string, FeatureFlag>> {
    const response = await apiClient.request<{
      success: boolean;
      data: Record<string, FeatureFlag>;
    }>(`${this.baseUrl}/all`);
    return response.data;
  }

  // Set a feature flag
  async setFlag(
    flagName: string,
    enabled: boolean
  ): Promise<{ flag_name: string; enabled: boolean }> {
    const response = await apiClient.request<{
      success: boolean;
      data: { flag_name: string; enabled: boolean };
    }>(`${this.baseUrl}/set`, {
      method: "POST",
      body: JSON.stringify({
        flag_name: flagName,
        enabled: enabled,
      } as SetFlagRequest),
    });
    return response.data;
  }

  // Check if a specific flag is enabled
  async isFlagEnabled(
    flagName: string
  ): Promise<{ flag_name: string; enabled: boolean }> {
    const response = await apiClient.request<{
      success: boolean;
      data: { flag_name: string; enabled: boolean };
    }>(`${this.baseUrl}/${flagName}`);
    return response.data;
  }

  // Set multiple flags at once
  async batchSetFlags(requests: SetFlagRequest[]): Promise<{
    success_count: number;
    error_count: number;
    results: { flag_name: string; enabled: boolean }[];
    errors?: { flag_name: string; error: string }[];
  }> {
    const response = await apiClient.request<{
      success: boolean;
      data: {
        success_count: number;
        error_count: number;
        results: { flag_name: string; enabled: boolean }[];
        errors?: { flag_name: string; error: string }[];
      };
    }>(`${this.baseUrl}/batch-set`, {
      method: "POST",
      body: JSON.stringify(requests),
    });
    return response.data;
  }

  // Get migration statistics
  async getMigrationStats(): Promise<MigrationStats> {
    const response = await apiClient.request<{
      success: boolean;
      data: MigrationStats;
    }>(`${this.baseUrl}/migration/stats`);
    return response.data;
  }

  // Get current migration phase and recommendations
  async getMigrationPhase(): Promise<MigrationPhase> {
    const response = await apiClient.request<{
      success: boolean;
      data: MigrationPhase;
    }>(`${this.baseUrl}/migration/phase`);
    return response.data;
  }

  // Enable LiveKit for a specific meeting
  async enableLiveKitForMeeting(
    meetingId: string
  ): Promise<{ meeting_id: string; enabled: boolean }> {
    const response = await apiClient.request<{
      success: boolean;
      data: { meeting_id: string; enabled: boolean };
    }>(`${this.baseUrl}/meetings/livekit/enable`, {
      method: "POST",
      body: JSON.stringify({
        meeting_id: meetingId,
        enabled: true,
      } as MeetingFlagRequest),
    });
    return response.data;
  }

  // Disable LiveKit for a specific meeting
  async disableLiveKitForMeeting(
    meetingId: string
  ): Promise<{ meeting_id: string; enabled: boolean }> {
    const response = await apiClient.request<{
      success: boolean;
      data: { meeting_id: string; enabled: boolean };
    }>(`${this.baseUrl}/meetings/${meetingId}/livekit`, {
      method: "DELETE",
    });
    return response.data;
  }

  // Check if LiveKit should be used for a specific meeting
  async shouldUseLiveKitForMeeting(
    meetingId: string
  ): Promise<ArchitectureInfo> {
    const response = await apiClient.request<{
      success: boolean;
      data: ArchitectureInfo;
    }>(`${this.baseUrl}/meetings/${meetingId}/livekit`);
    return response.data;
  }

  // Cleanup expired flags
  async cleanupExpiredFlags(): Promise<void> {
    await apiClient.request(`${this.baseUrl}/cleanup`, {
      method: "POST",
    });
  }

  // Helper methods for common operations

  // Check if SFU (LiveKit) should be used globally
  async shouldUseSFUGlobally(): Promise<boolean> {
    const config = await this.getFeatureConfig();
    return config.use_livekit_sfu;
  }

  // Check if mesh WebRTC should be used globally
  async shouldUseMeshGlobally(): Promise<boolean> {
    const config = await this.getFeatureConfig();
    return config.use_webrtc_mesh;
  }

  // Enable parallel testing mode (both SFU and mesh)
  async enableParallelTesting(): Promise<void> {
    await this.batchSetFlags([
      { flag_name: "use_livekit_sfu", enabled: true },
      { flag_name: "use_webrtc_mesh", enabled: true },
    ]);
  }

  // Enable SFU-only mode
  async enableSFUOnlyMode(): Promise<void> {
    await this.batchSetFlags([
      { flag_name: "use_livekit_sfu", enabled: true },
      { flag_name: "use_webrtc_mesh", enabled: false },
    ]);
  }

  // Enable mesh-only mode
  async enableMeshOnlyMode(): Promise<void> {
    await this.batchSetFlags([
      { flag_name: "use_livekit_sfu", enabled: false },
      { flag_name: "use_webrtc_mesh", enabled: true },
    ]);
  }

  // Get architecture recommendation for a meeting
  async getArchitectureRecommendation(meetingId: string): Promise<{
    recommended: "SFU (LiveKit)" | "Mesh (WebRTC)";
    reason: string;
    fallback: "SFU (LiveKit)" | "Mesh (WebRTC)";
  }> {
    const architectureInfo = await this.shouldUseLiveKitForMeeting(meetingId);
    const migrationPhase = await this.getMigrationPhase();

    const recommended = architectureInfo.architecture;
    const fallback = architectureInfo.should_use
      ? "Mesh (WebRTC)"
      : "SFU (LiveKit)";

    let reason = "";
    switch (migrationPhase.phase) {
      case "mesh_only":
        reason = "Currently using mesh WebRTC architecture only";
        break;
      case "parallel_testing":
        reason = "Testing both architectures - using configured preference";
        break;
      case "sfu_only":
        reason = "Using SFU architecture for better scalability";
        break;
      default:
        reason = "Architecture determined by meeting-specific settings";
    }

    return {
      recommended,
      reason,
      fallback,
    };
  }

  // Monitor migration progress
  async getMigrationProgress(): Promise<{
    phase: string;
    completion: number; // 0-100
    nextSteps: string[];
    warnings: string[];
  }> {
    const stats = await this.getMigrationStats();
    const phase = await this.getMigrationPhase();

    let completion = 0;
    let nextSteps: string[] = [];
    let warnings: string[] = [];

    switch (stats.migration_phase) {
      case "mesh_only":
        completion = 0;
        nextSteps = phase.recommendations;
        warnings.push(
          "Still using mesh architecture - consider enabling SFU for testing"
        );
        break;
      case "parallel_testing":
        completion = 50;
        nextSteps = [
          "Monitor performance metrics",
          "Collect user feedback",
          "Gradually increase SFU usage",
        ];
        if (stats.livekit_meeting_count === 0) {
          warnings.push(
            "No meetings using LiveKit yet - start enabling for test meetings"
          );
        }
        break;
      case "sfu_only":
        completion = 100;
        nextSteps = [
          "Monitor system performance",
          "Optimize SFU configuration",
          "Plan for scaling",
        ];
        break;
      default:
        completion = 0;
        warnings.push("Unknown migration phase - check configuration");
    }

    return {
      phase: stats.migration_phase,
      completion,
      nextSteps,
      warnings,
    };
  }
}

export const featureFlagService = new FeatureFlagService();
export default featureFlagService;
