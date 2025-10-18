import { useState, useEffect, useCallback } from "react";
import featureFlagService, {
  FeatureFlagConfig,
  MigrationStats,
  MigrationPhase,
  ArchitectureInfo,
} from "../lib/feature-flag-service";

export interface UseFeatureFlagsReturn {
  // Feature configuration
  config: FeatureFlagConfig | null;
  isLoading: boolean;
  error: string | null;

  // Migration info
  migrationStats: MigrationStats | null;
  migrationPhase: MigrationPhase | null;

  // Actions
  refreshConfig: () => Promise<void>;
  setFlag: (flagName: string, enabled: boolean) => Promise<void>;
  enableParallelTesting: () => Promise<void>;
  enableSFUOnlyMode: () => Promise<void>;
  enableMeshOnlyMode: () => Promise<void>;

  // Meeting-specific
  shouldUseLiveKitForMeeting: (meetingId: string) => Promise<ArchitectureInfo>;
  enableLiveKitForMeeting: (meetingId: string) => Promise<void>;
  disableLiveKitForMeeting: (meetingId: string) => Promise<void>;

  // Convenience methods
  shouldUseSFUGlobally: () => boolean;
  shouldUseMeshGlobally: () => boolean;
  getMigrationProgress: () => Promise<{
    phase: string;
    completion: number;
    nextSteps: string[];
    warnings: string[];
  }>;
}

export const useFeatureFlags = (): UseFeatureFlagsReturn => {
  const [config, setConfig] = useState<FeatureFlagConfig | null>(null);
  const [migrationStats, setMigrationStats] = useState<MigrationStats | null>(
    null
  );
  const [migrationPhase, setMigrationPhase] = useState<MigrationPhase | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial data
  const loadInitialData = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      const [featureConfig, stats, phase] = await Promise.all([
        featureFlagService.getFeatureConfig(),
        featureFlagService.getMigrationStats(),
        featureFlagService.getMigrationPhase(),
      ]);

      setConfig(featureConfig);
      setMigrationStats(stats);
      setMigrationPhase(phase);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to load feature flags";
      setError(errorMessage);
      console.error("Error loading feature flags:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Refresh configuration
  const refreshConfig = useCallback(async (): Promise<void> => {
    await loadInitialData();
  }, [loadInitialData]);

  // Set a specific flag
  const setFlag = useCallback(
    async (flagName: string, enabled: boolean): Promise<void> => {
      try {
        await featureFlagService.setFlag(flagName, enabled);
        await refreshConfig();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to set flag";
        setError(errorMessage);
        throw err;
      }
    },
    [refreshConfig]
  );

  // Enable parallel testing mode
  const enableParallelTesting = useCallback(async (): Promise<void> => {
    try {
      await featureFlagService.enableParallelTesting();
      await refreshConfig();
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to enable parallel testing";
      setError(errorMessage);
      throw err;
    }
  }, [refreshConfig]);

  // Enable SFU-only mode
  const enableSFUOnlyMode = useCallback(async (): Promise<void> => {
    try {
      await featureFlagService.enableSFUOnlyMode();
      await refreshConfig();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to enable SFU-only mode";
      setError(errorMessage);
      throw err;
    }
  }, [refreshConfig]);

  // Enable mesh-only mode
  const enableMeshOnlyMode = useCallback(async (): Promise<void> => {
    try {
      await featureFlagService.enableMeshOnlyMode();
      await refreshConfig();
      return;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to enable mesh-only mode";
      setError(errorMessage);
      throw err;
    }
  }, [refreshConfig]);

  // Check if LiveKit should be used for a specific meeting
  const shouldUseLiveKitForMeeting = useCallback(
    async (meetingId: string): Promise<ArchitectureInfo> => {
      try {
        return await featureFlagService.shouldUseLiveKitForMeeting(meetingId);
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Failed to check LiveKit setting for meeting";
        setError(errorMessage);
        throw err;
      }
    },
    []
  );

  // Enable LiveKit for a specific meeting
  const enableLiveKitForMeeting = useCallback(
    async (meetingId: string): Promise<void> => {
      try {
        await featureFlagService.enableLiveKitForMeeting(meetingId);
        await refreshConfig();
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Failed to enable LiveKit for meeting";
        setError(errorMessage);
        throw err;
      }
    },
    [refreshConfig]
  );

  // Disable LiveKit for a specific meeting
  const disableLiveKitForMeeting = useCallback(
    async (meetingId: string): Promise<void> => {
      try {
        await featureFlagService.disableLiveKitForMeeting(meetingId);
        await refreshConfig();
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Failed to disable LiveKit for meeting";
        setError(errorMessage);
        throw err;
      }
    },
    [refreshConfig]
  );

  // Convenience methods
  const shouldUseSFUGlobally = useCallback((): boolean => {
    return config?.use_livekit_sfu ?? false;
  }, [config]);

  const shouldUseMeshGlobally = useCallback((): boolean => {
    return config?.use_webrtc_mesh ?? false;
  }, [config]);

  const getMigrationProgress = useCallback(async () => {
    try {
      return await featureFlagService.getMigrationProgress();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to get migration progress";
      setError(errorMessage);
      throw err;
    }
  }, []);

  // Load data on mount
  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  return {
    // State
    config,
    isLoading,
    error,
    migrationStats,
    migrationPhase,

    // Actions
    refreshConfig,
    setFlag,
    enableParallelTesting,
    enableSFUOnlyMode,
    enableMeshOnlyMode,

    // Meeting-specific
    shouldUseLiveKitForMeeting,
    enableLiveKitForMeeting,
    disableLiveKitForMeeting,

    // Convenience methods
    shouldUseSFUGlobally,
    shouldUseMeshGlobally,
    getMigrationProgress,
  };
};

// Hook for meeting-specific architecture decisions
export interface UseMeetingArchitectureReturn {
  architecture: "SFU (LiveKit)" | "Mesh (WebRTC)" | null;
  isLoading: boolean;
  error: string | null;
  recommendation: {
    recommended: "SFU (LiveKit)" | "Mesh (WebRTC)";
    reason: string;
    fallback: "SFU (LiveKit)" | "Mesh (WebRTC)";
  } | null;
  refresh: () => Promise<void>;
  switchToLiveKit: () => Promise<void>;
  switchToMesh: () => Promise<void>;
}

export const useMeetingArchitecture = (
  meetingId: string
): UseMeetingArchitectureReturn => {
  const [architecture, setArchitecture] = useState<
    "SFU (LiveKit)" | "Mesh (WebRTC)" | null
  >(null);
  const [recommendation, setRecommendation] =
    useState<UseMeetingArchitectureReturn["recommendation"]>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadArchitectureInfo = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      const [architectureInfo, recommendationInfo] = await Promise.all([
        featureFlagService.shouldUseLiveKitForMeeting(meetingId),
        featureFlagService.getArchitectureRecommendation(meetingId),
      ]);

      setArchitecture(architectureInfo.architecture);
      setRecommendation(recommendationInfo);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to load architecture info";
      setError(errorMessage);
      console.error("Error loading architecture info:", err);
    } finally {
      setIsLoading(false);
    }
  }, [meetingId]);

  const refresh = useCallback(async (): Promise<void> => {
    await loadArchitectureInfo();
  }, [loadArchitectureInfo]);

  const switchToLiveKit = useCallback(async (): Promise<void> => {
    try {
      await featureFlagService.enableLiveKitForMeeting(meetingId);
      await refresh();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to switch to LiveKit";
      setError(errorMessage);
      throw err;
    }
  }, [meetingId, refresh]);

  const switchToMesh = useCallback(async (): Promise<void> => {
    try {
      await featureFlagService.disableLiveKitForMeeting(meetingId);
      await refresh();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to switch to Mesh";
      setError(errorMessage);
      throw err;
    }
  }, [meetingId, refresh]);

  useEffect(() => {
    if (meetingId) {
      loadArchitectureInfo();
    }
  }, [meetingId, loadArchitectureInfo]);

  return {
    architecture,
    isLoading,
    error,
    recommendation,
    refresh,
    switchToLiveKit,
    switchToMesh,
  };
};

// Hook for migration monitoring
export interface UseMigrationMonitorReturn {
  progress: {
    phase: string;
    completion: number;
    nextSteps: string[];
    warnings: string[];
  } | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useMigrationMonitor = (): UseMigrationMonitorReturn => {
  const [progress, setProgress] =
    useState<UseMigrationMonitorReturn["progress"]>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProgress = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      const progressData = await featureFlagService.getMigrationProgress();
      setProgress(progressData);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to load migration progress";
      setError(errorMessage);
      console.error("Error loading migration progress:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    await loadProgress();
  }, [loadProgress]);

  useEffect(() => {
    loadProgress();
  }, [loadProgress]);

  return {
    progress,
    isLoading,
    error,
    refresh,
  };
};
