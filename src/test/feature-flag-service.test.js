// Feature Flag Service Tests
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the apiClient module
vi.mock("../lib/api-client", () => ({
  apiClient: {
    request: vi.fn(),
  },
}));

import featureFlagService from "../lib/feature-flag-service";
import { apiClient } from "../lib/api-client";

describe("FeatureFlagService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getFeatureConfig", () => {
    it("should return feature configuration", async () => {
      const mockConfig = {
        use_livekit_sfu: true,
        use_webrtc_mesh: false,
        enable_sfu_logs: true,
      };

      apiClient.request.mockResolvedValue({
        success: true,
        data: mockConfig,
      });

      const result = await featureFlagService.getFeatureConfig();

      expect(apiClient.request).toHaveBeenCalledWith(
        "/api/v1/feature-flags/config"
      );
      expect(result).toEqual(mockConfig);
    });

    it("should handle API errors", async () => {
      apiClient.request.mockRejectedValue(new Error("Network error"));

      await expect(featureFlagService.getFeatureConfig()).rejects.toThrow(
        "Network error"
      );
    });
  });

  describe("getAllFlags", () => {
    it("should return all feature flags", async () => {
      const mockFlags = {
        use_livekit_sfu: {
          name: "use_livekit_sfu",
          enabled: true,
          description: "Use LiveKit SFU for video conferencing",
          updated_at: "2023-01-01T00:00:00Z",
        },
        use_webrtc_mesh: {
          name: "use_webrtc_mesh",
          enabled: false,
          description: "Use traditional mesh WebRTC",
          updated_at: "2023-01-01T00:00:00Z",
        },
      };

      apiClient.request.mockResolvedValue({
        success: true,
        data: mockFlags,
      });

      const result = await featureFlagService.getAllFlags();

      expect(apiClient.request).toHaveBeenCalledWith(
        "/api/v1/feature-flags/all"
      );
      expect(result).toEqual(mockFlags);
    });
  });

  describe("setFlag", () => {
    it("should set a feature flag", async () => {
      const mockResponse = {
        flag_name: "use_livekit_sfu",
        enabled: true,
      };

      apiClient.request.mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await featureFlagService.setFlag("use_livekit_sfu", true);

      expect(apiClient.request).toHaveBeenCalledWith(
        "/api/v1/feature-flags/set",
        {
          method: "POST",
          body: JSON.stringify({
            flag_name: "use_livekit_sfu",
            enabled: true,
          }),
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("isFlagEnabled", () => {
    it("should check if a flag is enabled", async () => {
      const mockResponse = {
        flag_name: "use_livekit_sfu",
        enabled: true,
      };

      apiClient.request.mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await featureFlagService.isFlagEnabled("use_livekit_sfu");

      expect(apiClient.request).toHaveBeenCalledWith(
        "/api/v1/feature-flags/use_livekit_sfu"
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("batchSetFlags", () => {
    it("should set multiple flags", async () => {
      const requests = [
        { flag_name: "use_livekit_sfu", enabled: true },
        { flag_name: "use_webrtc_mesh", enabled: false },
      ];

      const mockResponse = {
        success_count: 2,
        error_count: 0,
        results: [
          { flag_name: "use_livekit_sfu", enabled: true },
          { flag_name: "use_webrtc_mesh", enabled: false },
        ],
      };

      apiClient.request.mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await featureFlagService.batchSetFlags(requests);

      expect(apiClient.request).toHaveBeenCalledWith(
        "/api/v1/feature-flags/batch-set",
        {
          method: "POST",
          body: JSON.stringify(requests),
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("getMigrationStats", () => {
    it("should return migration statistics", async () => {
      const mockStats = {
        livekit_meeting_count: 5,
        global_livekit_enabled: true,
        global_mesh_enabled: true,
        sfu_logs_enabled: true,
        migration_phase: "parallel_testing",
        updated_at: "2023-01-01T00:00:00Z",
      };

      apiClient.request.mockResolvedValue({
        success: true,
        data: mockStats,
      });

      const result = await featureFlagService.getMigrationStats();

      expect(apiClient.request).toHaveBeenCalledWith(
        "/api/v1/feature-flags/migration/stats"
      );
      expect(result).toEqual(mockStats);
    });
  });

  describe("getMigrationPhase", () => {
    it("should return migration phase information", async () => {
      const mockPhase = {
        phase: "parallel_testing",
        description:
          "Running both mesh WebRTC and SFU (LiveKit) in parallel for testing",
        recommendations: [
          "Gradually increase the percentage of meetings using LiveKit",
          "Compare performance metrics between mesh and SFU",
          "Collect user feedback on video quality and reliability",
        ],
        config: {
          use_livekit_sfu: true,
          use_webrtc_mesh: true,
          enable_sfu_logs: true,
        },
      };

      apiClient.request.mockResolvedValue({
        success: true,
        data: mockPhase,
      });

      const result = await featureFlagService.getMigrationPhase();

      expect(apiClient.request).toHaveBeenCalledWith(
        "/api/v1/feature-flags/migration/phase"
      );
      expect(result).toEqual(mockPhase);
    });
  });

  describe("enableLiveKitForMeeting", () => {
    it("should enable LiveKit for a specific meeting", async () => {
      const meetingId = "test-meeting-123";
      const mockResponse = {
        meeting_id: meetingId,
        enabled: true,
      };

      apiClient.request.mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await featureFlagService.enableLiveKitForMeeting(
        meetingId
      );

      expect(apiClient.request).toHaveBeenCalledWith(
        "/api/v1/feature-flags/meetings/livekit/enable",
        {
          method: "POST",
          body: JSON.stringify({
            meeting_id: meetingId,
            enabled: true,
          }),
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("disableLiveKitForMeeting", () => {
    it("should disable LiveKit for a specific meeting", async () => {
      const meetingId = "test-meeting-123";
      const mockResponse = {
        meeting_id: meetingId,
        enabled: false,
      };

      apiClient.request.mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await featureFlagService.disableLiveKitForMeeting(
        meetingId
      );

      expect(apiClient.request).toHaveBeenCalledWith(
        `/api/v1/feature-flags/meetings/${meetingId}/livekit`,
        {
          method: "DELETE",
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("shouldUseLiveKitForMeeting", () => {
    it("should check if LiveKit should be used for a meeting", async () => {
      const meetingId = "test-meeting-123";
      const mockResponse = {
        meeting_id: meetingId,
        should_use: true,
        architecture: "SFU (LiveKit)",
      };

      apiClient.request.mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await featureFlagService.shouldUseLiveKitForMeeting(
        meetingId
      );

      expect(apiClient.request).toHaveBeenCalledWith(
        `/api/v1/feature-flags/meetings/${meetingId}/livekit`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("cleanupExpiredFlags", () => {
    it("should cleanup expired flags", async () => {
      apiClient.request.mockResolvedValue({ success: true });

      await featureFlagService.cleanupExpiredFlags();

      expect(apiClient.request).toHaveBeenCalledWith(
        "/api/v1/feature-flags/cleanup",
        {
          method: "POST",
        }
      );
    });
  });

  describe("Convenience methods", () => {
    beforeEach(() => {
      // Mock getFeatureConfig for convenience methods
      apiClient.request.mockImplementation((endpoint) => {
        if (endpoint === "/api/v1/feature-flags/config") {
          return Promise.resolve({
            success: true,
            data: {
              use_livekit_sfu: true,
              use_webrtc_mesh: false,
              enable_sfu_logs: true,
            },
          });
        }
        return Promise.resolve({ success: true, data: {} });
      });
    });

    it("should return SFU usage globally", async () => {
      const result = await featureFlagService.shouldUseSFUGlobally();
      expect(result).toBe(true);
    });

    it("should return mesh usage globally", async () => {
      const result = await featureFlagService.shouldUseMeshGlobally();
      expect(result).toBe(false);
    });
  });

  describe("enableParallelTesting", () => {
    it("should enable parallel testing mode", async () => {
      const mockResponse = {
        success_count: 2,
        error_count: 0,
        results: [
          { flag_name: "use_livekit_sfu", enabled: true },
          { flag_name: "use_webrtc_mesh", enabled: true },
        ],
      };

      apiClient.request.mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      await featureFlagService.enableParallelTesting();

      expect(apiClient.request).toHaveBeenCalledWith(
        "/api/v1/feature-flags/batch-set",
        {
          method: "POST",
          body: JSON.stringify([
            { flag_name: "use_livekit_sfu", enabled: true },
            { flag_name: "use_webrtc_mesh", enabled: true },
          ]),
        }
      );
    });
  });

  describe("enableSFUOnlyMode", () => {
    it("should enable SFU-only mode", async () => {
      const mockResponse = {
        success_count: 2,
        error_count: 0,
        results: [
          { flag_name: "use_livekit_sfu", enabled: true },
          { flag_name: "use_webrtc_mesh", enabled: false },
        ],
      };

      apiClient.request.mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      await featureFlagService.enableSFUOnlyMode();

      expect(apiClient.request).toHaveBeenCalledWith(
        "/api/v1/feature-flags/batch-set",
        {
          method: "POST",
          body: JSON.stringify([
            { flag_name: "use_livekit_sfu", enabled: true },
            { flag_name: "use_webrtc_mesh", enabled: false },
          ]),
        }
      );
    });
  });

  describe("enableMeshOnlyMode", () => {
    it("should enable mesh-only mode", async () => {
      const mockResponse = {
        success_count: 2,
        error_count: 0,
        results: [
          { flag_name: "use_livekit_sfu", enabled: false },
          { flag_name: "use_webrtc_mesh", enabled: true },
        ],
      };

      apiClient.request.mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      await featureFlagService.enableMeshOnlyMode();

      expect(apiClient.request).toHaveBeenCalledWith(
        "/api/v1/feature-flags/batch-set",
        {
          method: "POST",
          body: JSON.stringify([
            { flag_name: "use_livekit_sfu", enabled: false },
            { flag_name: "use_webrtc_mesh", enabled: true },
          ]),
        }
      );
    });
  });

  describe("getArchitectureRecommendation", () => {
    it("should return architecture recommendation for a meeting", async () => {
      const meetingId = "test-meeting-123";

      // Mock the two API calls
      apiClient.request
        .mockResolvedValueOnce({
          success: true,
          data: {
            meeting_id: meetingId,
            should_use: true,
            architecture: "SFU (LiveKit)",
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            phase: "parallel_testing",
            description: "Running both architectures",
            recommendations: ["Monitor performance"],
            config: {
              use_livekit_sfu: true,
              use_webrtc_mesh: true,
              enable_sfu_logs: true,
            },
          },
        });

      const result = await featureFlagService.getArchitectureRecommendation(
        meetingId
      );

      expect(result).toEqual({
        recommended: "SFU (LiveKit)",
        reason: "Testing both architectures - using configured preference",
        fallback: "Mesh (WebRTC)",
      });
    });
  });

  describe("getMigrationProgress", () => {
    it("should return migration progress", async () => {
      // Mock the two API calls
      apiClient.request
        .mockResolvedValueOnce({
          success: true,
          data: {
            livekit_meeting_count: 5,
            global_livekit_enabled: true,
            global_mesh_enabled: true,
            sfu_logs_enabled: true,
            migration_phase: "parallel_testing",
            updated_at: "2023-01-01T00:00:00Z",
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            phase: "parallel_testing",
            description: "Running both architectures",
            recommendations: ["Monitor performance"],
            config: {
              use_livekit_sfu: true,
              use_webrtc_mesh: true,
              enable_sfu_logs: true,
            },
          },
        });

      const result = await featureFlagService.getMigrationProgress();

      expect(result).toEqual({
        phase: "parallel_testing",
        completion: 50,
        nextSteps: [
          "Monitor performance metrics",
          "Collect user feedback",
          "Gradually increase SFU usage",
        ],
        warnings: [],
      });
    });

    it("should return warnings when no meetings use LiveKit", async () => {
      // Mock the two API calls
      apiClient.request
        .mockResolvedValueOnce({
          success: true,
          data: {
            livekit_meeting_count: 0,
            global_livekit_enabled: true,
            global_mesh_enabled: true,
            sfu_logs_enabled: true,
            migration_phase: "parallel_testing",
            updated_at: "2023-01-01T00:00:00Z",
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            phase: "parallel_testing",
            description: "Running both architectures",
            recommendations: ["Monitor performance"],
            config: {
              use_livekit_sfu: true,
              use_webrtc_mesh: true,
              enable_sfu_logs: true,
            },
          },
        });

      const result = await featureFlagService.getMigrationProgress();

      expect(result.warnings).toContain(
        "No meetings using LiveKit yet - start enabling for test meetings"
      );
    });
  });
});
