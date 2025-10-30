import {
  getAudioContextPool,
  type AudioContextStats,
  type AudioContextPool,
} from "./audio-context-pool";

/**
 * Audio Context Monitor
 *
 * Utility untuk monitoring dan debugging audio context pool usage
 */

export interface AudioMonitorConfig {
  updateInterval?: number; // in milliseconds
  enableConsoleLogging?: boolean;
  enablePerformanceMetrics?: boolean;
}

export interface AudioMetrics {
  timestamp: number;
  stats: AudioContextStats;
  poolStats: {
    created: number;
    reused: number;
    destroyed: number;
    cleanupRuns: number;
    memoryLeaksPrevented: number;
  };
  performanceMetrics?: {
    averageAcquireTime: number;
    averageReleaseTime: number;
    totalOperations: number;
  };
}

export class AudioMonitor {
  private pool: AudioContextPool;
  private config: AudioMonitorConfig;
  private isMonitoring = false;
  private monitoringTimer: NodeJS.Timeout | null = null;
  private metrics: AudioMetrics[] = [];
  private maxMetricsHistory = 100;

  // Performance tracking
  private operationTimes: { [key: string]: number[] } = {
    acquire: [],
    release: [],
  };

  constructor(config: AudioMonitorConfig = {}) {
    this.pool = getAudioContextPool();
    this.config = {
      updateInterval: 5000, // 5 seconds
      enableConsoleLogging: true,
      enablePerformanceMetrics: true,
      ...config,
    };
  }

  /**
   * Start monitoring audio context pool
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      console.warn("[AudioMonitor] Monitoring already started");
      return;
    }

    this.isMonitoring = true;
    console.log("[AudioMonitor] Starting audio context pool monitoring");

    // Start periodic monitoring
    this.monitoringTimer = setInterval(() => {
      this.collectMetrics();
    }, this.config.updateInterval);

    // Collect initial metrics
    this.collectMetrics();
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    console.log("[AudioMonitor] Stopping audio context pool monitoring");

    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
  }

  /**
   * Get current metrics
   */
  getCurrentMetrics(): AudioMetrics | null {
    return this.metrics.length > 0
      ? this.metrics[this.metrics.length - 1]
      : null;
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(): AudioMetrics[] {
    return [...this.metrics];
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary() {
    const acquireTimes = this.operationTimes.acquire;
    const releaseTimes = this.operationTimes.release;

    return {
      acquire: {
        count: acquireTimes.length,
        average:
          acquireTimes.length > 0
            ? acquireTimes.reduce((a, b) => a + b, 0) / acquireTimes.length
            : 0,
        min: acquireTimes.length > 0 ? Math.min(...acquireTimes) : 0,
        max: acquireTimes.length > 0 ? Math.max(...acquireTimes) : 0,
      },
      release: {
        count: releaseTimes.length,
        average:
          releaseTimes.length > 0
            ? releaseTimes.reduce((a, b) => a + b, 0) / releaseTimes.length
            : 0,
        min: releaseTimes.length > 0 ? Math.min(...releaseTimes) : 0,
        max: releaseTimes.length > 0 ? Math.max(...releaseTimes) : 0,
      },
    };
  }

  /**
   * Get health status
   */
  getHealthStatus(): {
    status: "healthy" | "warning" | "critical";
    issues: string[];
    recommendations: string[];
  } {
    const currentMetrics = this.getCurrentMetrics();
    if (!currentMetrics) {
      return {
        status: "warning",
        issues: ["No metrics available"],
        recommendations: ["Start monitoring to get health status"],
      };
    }

    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check for memory leaks
    if (
      currentMetrics.stats.destroyedContexts >
      currentMetrics.stats.totalContexts * 0.5
    ) {
      issues.push("High number of destroyed contexts detected");
      recommendations.push(
        "Check for proper context cleanup in application code"
      );
    }

    // Check pool utilization
    const poolUtilization = currentMetrics.stats.activeContexts / 10; // Assuming max pool size of 10
    if (poolUtilization > 0.8) {
      issues.push("High pool utilization");
      recommendations.push(
        "Consider increasing pool size or optimizing context usage"
      );
    }

    // Check average age
    if (currentMetrics.stats.averageAge > 10 * 60 * 1000) {
      // 10 minutes
      issues.push("Contexts are living too long");
      recommendations.push("Review context release patterns");
    }

    // Check memory usage
    if (currentMetrics.stats.memoryUsage > 100 * 1024 * 1024) {
      // 100MB
      issues.push("High memory usage");
      recommendations.push("Consider reducing context lifetime or pool size");
    }

    let status: "healthy" | "warning" | "critical" = "healthy";
    if (issues.length > 0) {
      status = issues.length > 2 ? "critical" : "warning";
    }

    return {
      status,
      issues,
      recommendations,
    };
  }

  /**
   * Export metrics for analysis
   */
  exportMetrics(): string {
    const exportData = {
      timestamp: new Date().toISOString(),
      config: this.config,
      metrics: this.metrics,
      performanceSummary: this.getPerformanceSummary(),
      healthStatus: this.getHealthStatus(),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Clear metrics history
   */
  clearMetrics(): void {
    this.metrics = [];
    this.operationTimes = {
      acquire: [],
      release: [],
    };
    console.log("[AudioMonitor] Metrics cleared");
  }

  /**
   * Track operation performance
   */
  trackOperation(operation: "acquire" | "release", duration: number): void {
    if (!this.config.enablePerformanceMetrics) {
      return;
    }

    this.operationTimes[operation].push(duration);

    // Keep only last 100 operations
    if (this.operationTimes[operation].length > 100) {
      this.operationTimes[operation] =
        this.operationTimes[operation].slice(-100);
    }
  }

  /**
   * Collect metrics from pool
   */
  private collectMetrics(): void {
    try {
      const stats = this.pool.getStats();
      const detailedStats = this.pool.getDetailedStats();

      const metrics: AudioMetrics = {
        timestamp: Date.now(),
        stats,
        poolStats: detailedStats.pool,
        performanceMetrics: this.config.enablePerformanceMetrics
          ? {
              averageAcquireTime: this.getAverageTime("acquire"),
              averageReleaseTime: this.getAverageTime("release"),
              totalOperations: this.getTotalOperations(),
            }
          : undefined,
      };

      // Add to history
      this.metrics.push(metrics);

      // Maintain history size
      if (this.metrics.length > this.maxMetricsHistory) {
        this.metrics = this.metrics.slice(-this.maxMetricsHistory);
      }

      // Log to console if enabled
      if (this.config.enableConsoleLogging) {
        this.logMetrics(metrics);
      }

      // Check for issues
      this.checkForIssues(metrics);
    } catch (error) {
      console.error("[AudioMonitor] Error collecting metrics:", error);
    }
  }

  /**
   * Log metrics to console
   */
  private logMetrics(metrics: AudioMetrics): void {
    console.group(
      `[AudioMonitor] Metrics - ${new Date(metrics.timestamp).toLocaleTimeString()}`
    );
    console.log("Pool Status:", {
      total: metrics.stats.totalContexts,
      active: metrics.stats.activeContexts,
      idle: metrics.stats.idleContexts,
      memory: `${(metrics.stats.memoryUsage / 1024 / 1024).toFixed(2)}MB`,
    });
    console.log("Pool Operations:", {
      created: metrics.poolStats.created,
      reused: metrics.poolStats.reused,
      destroyed: metrics.poolStats.destroyed,
      memoryLeaksPrevented: metrics.poolStats.memoryLeaksPrevented,
    });

    if (metrics.performanceMetrics) {
      console.log("Performance:", {
        avgAcquireTime: `${metrics.performanceMetrics.averageAcquireTime.toFixed(2)}ms`,
        avgReleaseTime: `${metrics.performanceMetrics.averageReleaseTime.toFixed(2)}ms`,
        totalOps: metrics.performanceMetrics.totalOperations,
      });
    }

    console.groupEnd();
  }

  /**
   * Check for potential issues
   */
  private checkForIssues(metrics: AudioMetrics): void {
    const health = this.getHealthStatus();

    if (health.status !== "healthy") {
      console.warn(
        `[AudioMonitor] Health Status: ${health.status.toUpperCase()}`
      );
      health.issues.forEach((issue) => {
        console.warn(`[AudioMonitor] Issue: ${issue}`);
      });
    }
  }

  /**
   * Get average operation time
   */
  private getAverageTime(operation: "acquire" | "release"): number {
    const times = this.operationTimes[operation];
    return times.length > 0
      ? times.reduce((a, b) => a + b, 0) / times.length
      : 0;
  }

  /**
   * Get total operations count
   */
  private getTotalOperations(): number {
    return (
      this.operationTimes.acquire.length + this.operationTimes.release.length
    );
  }

  /**
   * Destroy monitor
   */
  destroy(): void {
    this.stopMonitoring();
    this.clearMetrics();
    console.log("[AudioMonitor] Monitor destroyed");
  }
}

// Singleton instance
let audioMonitorInstance: AudioMonitor | null = null;

/**
 * Get or create AudioMonitor singleton instance
 */
export function getAudioMonitor(config?: AudioMonitorConfig): AudioMonitor {
  if (!audioMonitorInstance) {
    audioMonitorInstance = new AudioMonitor(config);
  }
  return audioMonitorInstance;
}

/**
 * Destroy AudioMonitor singleton instance
 */
export function destroyAudioMonitor(): void {
  if (audioMonitorInstance) {
    audioMonitorInstance.destroy();
    audioMonitorInstance = null;
  }
}

/**
 * Factory function untuk membuat AudioMonitor dengan konfigurasi default
 */
export function createAudioMonitor(config?: AudioMonitorConfig): AudioMonitor {
  return new AudioMonitor({
    updateInterval: 5000, // 5 detik
    enableConsoleLogging: true,
    enablePerformanceMetrics: true,
    ...config,
  });
}
