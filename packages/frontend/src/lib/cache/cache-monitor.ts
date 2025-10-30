import { writable, derived } from "svelte/store";
import { cacheManager, cacheService } from "./cache-manager";
import { errorLogger } from "$lib/errors";

// Cache monitoring store interface
export interface CacheMonitorState {
  isEnabled: boolean;
  refreshInterval: number;
  lastUpdate: number;
  stats: {
    general: any;
    meetings: any;
    users: any;
  };
  history: CacheHistoryEntry[];
  maxHistorySize: number;
}

export interface CacheHistoryEntry {
  timestamp: number;
  hits: number;
  misses: number;
  hitRate: number;
  totalSize: number;
  evictions: number;
}

// Create cache monitoring store
function createCacheMonitorStore() {
  const initialState: CacheMonitorState = {
    isEnabled: true,
    refreshInterval: 5000, // 5 seconds
    lastUpdate: 0,
    stats: {
      general: {},
      meetings: {},
      users: {},
    },
    history: [],
    maxHistorySize: 100,
  };

  const store = writable<CacheMonitorState>(initialState);
  let refreshTimer: NodeJS.Timeout | null = null;

  // Update cache statistics
  const updateStats = () => {
    if (!initialState.isEnabled) return;

    try {
      const stats = cacheManager.getComprehensiveStats();
      const historyEntry: CacheHistoryEntry = {
        timestamp: Date.now(),
        hits: stats.general.hits,
        misses: stats.general.misses,
        hitRate: stats.general.hitRate,
        totalSize: stats.general.totalSize,
        evictions: stats.general.evictions,
      };

      store.update((current) => {
        // Update stats
        const newStats = {
          general: stats.general,
          meetings: stats.meetings,
          users: stats.users,
        };

        // Update history
        const newHistory = [...current.history, historyEntry];
        if (newHistory.length > current.maxHistorySize) {
          newHistory.shift();
        }

        return {
          ...current,
          stats: newStats,
          history: newHistory,
          lastUpdate: Date.now(),
        };
      });

      // Log performance metrics
      errorLogger.debug("Cache stats updated", {
        hitRate: stats.general.hitRate,
        totalSize: stats.general.totalSize,
        hits: stats.general.hits,
        misses: stats.general.misses,
      });
    } catch (error) {
      errorLogger.error("Failed to update cache stats", { error });
    }
  };

  // Start automatic refresh
  const startAutoRefresh = () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }

    refreshTimer = setInterval(() => {
      updateStats();
    }, initialState.refreshInterval);

    errorLogger.info("Cache monitoring auto-refresh started", {
      interval: initialState.refreshInterval,
    });
  };

  // Stop automatic refresh
  const stopAutoRefresh = () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }

    errorLogger.info("Cache monitoring auto-refresh stopped");
  };

  // Enable/disable monitoring
  const setEnabled = (enabled: boolean) => {
    store.update((current) => ({ ...current, isEnabled: enabled }));

    if (enabled) {
      startAutoRefresh();
      updateStats(); // Immediate update
    } else {
      stopAutoRefresh();
    }
  };

  // Set refresh interval
  const setRefreshInterval = (interval: number) => {
    store.update((current) => ({ ...current, refreshInterval: interval }));

    if (initialState.isEnabled) {
      startAutoRefresh();
    }
  };

  // Clear history
  const clearHistory = () => {
    store.update((current) => ({ ...current, history: [] }));
    errorLogger.info("Cache monitoring history cleared");
  };

  // Export cache data
  const exportData = () => {
    const current = get(store);
    const exportData = {
      timestamp: Date.now(),
      stats: current.stats,
      history: current.history,
      config: {
        refreshInterval: current.refreshInterval,
        maxHistorySize: current.maxHistorySize,
      },
    };

    errorLogger.info("Cache monitoring data exported", {
      historyEntries: current.history.length,
    });

    return exportData;
  };

  // Get performance insights
  const getPerformanceInsights = () => {
    const current = get(store);
    const { stats, history } = current;

    const insights = {
      hitRateStatus: "good" as "excellent" | "good" | "poor" | "critical",
      sizeStatus: "normal" as "normal" | "high" | "critical",
      evictionRate: "low" as "low" | "medium" | "high",
      trend: "stable" as "improving" | "stable" | "declining",
      recommendations: [] as string[],
    };

    // Analyze hit rate
    if (stats.general.hitRate >= 0.8) {
      insights.hitRateStatus = "excellent";
    } else if (stats.general.hitRate >= 0.6) {
      insights.hitRateStatus = "good";
    } else if (stats.general.hitRate >= 0.4) {
      insights.hitRateStatus = "poor";
    } else {
      insights.hitRateStatus = "critical";
      insights.recommendations.push(
        "Consider increasing TTL for frequently accessed data"
      );
    }

    // Analyze cache size
    const maxSize = 1000; // Default max size
    const sizePercentage = (stats.general.totalSize / maxSize) * 100;
    if (sizePercentage >= 90) {
      insights.sizeStatus = "critical";
      insights.recommendations.push(
        "Cache is near capacity, consider increasing max size"
      );
    } else if (sizePercentage >= 70) {
      insights.sizeStatus = "high";
    }

    // Analyze eviction rate
    const evictionRate =
      stats.general.evictions / Math.max(stats.general.sets, 1);
    if (evictionRate >= 0.3) {
      insights.evictionRate = "high";
      insights.recommendations.push(
        "High eviction rate detected, consider increasing cache size"
      );
    } else if (evictionRate >= 0.1) {
      insights.evictionRate = "medium";
    }

    // Analyze trend
    if (history.length >= 10) {
      const recent = history.slice(-5);
      const older = history.slice(-10, -5);

      const recentAvgHitRate =
        recent.reduce((sum, entry) => sum + entry.hitRate, 0) / recent.length;
      const olderAvgHitRate =
        older.reduce((sum, entry) => sum + entry.hitRate, 0) / older.length;

      if (recentAvgHitRate > olderAvgHitRate + 0.05) {
        insights.trend = "improving";
      } else if (recentAvgHitRate < olderAvgHitRate - 0.05) {
        insights.trend = "declining";
        insights.recommendations.push(
          "Cache performance is declining, review caching strategy"
        );
      }
    }

    return insights;
  };

  // Initialize monitoring
  const initialize = () => {
    updateStats(); // Initial update
    if (initialState.isEnabled) {
      startAutoRefresh();
    }
  };

  // Cleanup
  const destroy = () => {
    stopAutoRefresh();
  };

  // Derived stores for convenience
  const hitRate = derived(store, ($store) => $store.stats.general.hitRate || 0);
  const totalSize = derived(
    store,
    ($store) => $store.stats.general.totalSize || 0
  );
  const totalHits = derived(store, ($store) => $store.stats.general.hits || 0);
  const totalMisses = derived(
    store,
    ($store) => $store.stats.general.misses || 0
  );
  const totalEvictions = derived(
    store,
    ($store) => $store.stats.general.evictions || 0
  );

  return {
    subscribe: store.subscribe,

    // Actions
    updateStats,
    setEnabled,
    setRefreshInterval,
    clearHistory,
    exportData,
    getPerformanceInsights,

    // Derived stores
    hitRate,
    totalSize,
    totalHits,
    totalMisses,
    totalEvictions,

    // Lifecycle
    initialize,
    destroy,
  };
}

// Helper function to get store value
function get<T>(store: {
  subscribe: (fn: (value: T) => void) => () => void;
}): T {
  let value: T;
  store.subscribe((v) => (value = v))();
  return value!;
}

// Create singleton instance
export const cacheMonitorStore = createCacheMonitorStore();

// Auto-initialize
if (typeof window !== "undefined") {
  cacheMonitorStore.initialize();
}

// Export utilities
export const getCacheInsights = () =>
  cacheMonitorStore.getPerformanceInsights();
export const exportCacheData = () => cacheMonitorStore.exportData();
