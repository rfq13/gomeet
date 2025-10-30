import { cacheService, cacheManager } from "./cache-manager";
import { errorLogger } from "$lib/errors";

// Cache utilities for development and testing
export class CacheUtils {
  // Development utilities

  // Clear all cache (development only)
  static clearAllCache(): void {
    if (process.env.NODE_ENV === "development") {
      cacheManager.clearAllCache();
      errorLogger.info("Development: All cache cleared");
    }
  }

  // Get cache debug information
  static getDebugInfo(): {
    keys: string[];
    entries: Array<{
      key: string;
      ttl: number;
      timestamp: number;
      size: number;
      metadata?: any;
    }>;
    stats: any;
  } {
    const keys = cacheService.getKeys();
    const entries = keys
      .map((key) => {
        const entry = cacheService.getEntry(key);
        if (entry) {
          return {
            key,
            ttl: entry.ttl,
            timestamp: entry.timestamp,
            size: JSON.stringify(entry.data).length,
            metadata: entry.metadata,
          };
        }
        return null;
      })
      .filter(Boolean) as any[];

    return {
      keys,
      entries,
      stats: cacheService.getStats(),
    };
  }

  // Simulate cache hit/miss for testing
  static simulateCacheOperation(
    key: string,
    data: any,
    ttl: number = 5000
  ): void {
    if (process.env.NODE_ENV === "development") {
      cacheService.set(key, data, ttl, { simulated: true });
      errorLogger.debug("Development: Simulated cache operation", { key, ttl });
    }
  }

  // Performance testing utilities

  // Measure cache performance
  static async measureCachePerformance<T>(
    key: string,
    dataFetcher: () => Promise<T>,
    iterations: number = 100
  ): Promise<{
    withCache: { avgTime: number; totalTime: number; hits: number };
    withoutCache: { avgTime: number; totalTime: number };
    improvement: number;
  }> {
    const results = {
      withCache: { avgTime: 0, totalTime: 0, hits: 0 },
      withoutCache: { avgTime: 0, totalTime: 0 },
      improvement: 0,
    };

    // Clear cache for clean test
    cacheService.delete(key);

    // Test without cache
    const withoutCacheTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await dataFetcher();
      const end = performance.now();
      withoutCacheTimes.push(end - start);
    }

    results.withoutCache.totalTime = withoutCacheTimes.reduce(
      (a, b) => a + b,
      0
    );
    results.withoutCache.avgTime = results.withoutCache.totalTime / iterations;

    // Test with cache
    const withCacheTimes: number[] = [];
    let hits = 0;

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const cached = cacheService.get(key);
      if (cached) {
        hits++;
      } else {
        const data = await dataFetcher();
        cacheService.set(key, data, 60000); // 1 minute TTL
      }
      const end = performance.now();
      withCacheTimes.push(end - start);
    }

    results.withCache.totalTime = withCacheTimes.reduce((a, b) => a + b, 0);
    results.withCache.avgTime = results.withCache.totalTime / iterations;
    results.withCache.hits = hits;

    // Calculate improvement
    results.improvement =
      ((results.withoutCache.avgTime - results.withCache.avgTime) /
        results.withoutCache.avgTime) *
      100;

    errorLogger.info("Cache performance test completed", {
      key,
      iterations,
      improvement: results.improvement.toFixed(2) + "%",
      hitRate: ((hits / iterations) * 100).toFixed(2) + "%",
    });

    return results;
  }

  // Cache health check
  static performHealthCheck(): {
    status: "healthy" | "warning" | "critical";
    issues: string[];
    recommendations: string[];
    stats: any;
  } {
    const stats = cacheService.getStats();
    const issues: string[] = [];
    const recommendations: string[] = [];

    let status: "healthy" | "warning" | "critical" = "healthy";

    // Check hit rate
    if (stats.hitRate < 0.3) {
      status = "critical";
      issues.push("Very low cache hit rate");
      recommendations.push("Review caching strategy and TTL settings");
    } else if (stats.hitRate < 0.6) {
      status = "warning";
      issues.push("Low cache hit rate");
      recommendations.push(
        "Consider increasing TTL for frequently accessed data"
      );
    }

    // Check cache size
    if (stats.totalSize > 900) {
      status = status === "critical" ? "critical" : "warning";
      issues.push("Cache size is near capacity");
      recommendations.push(
        "Consider increasing cache size or implementing more aggressive eviction"
      );
    }

    // Check eviction rate
    const evictionRate = stats.evictions / Math.max(stats.sets, 1);
    if (evictionRate > 0.5) {
      status = "critical";
      issues.push("High eviction rate");
      recommendations.push(
        "Significantly increase cache size or review data retention policy"
      );
    } else if (evictionRate > 0.2) {
      status = status === "critical" ? "critical" : "warning";
      issues.push("Moderate eviction rate");
      recommendations.push(
        "Monitor cache size and consider increasing if needed"
      );
    }

    const healthCheck = {
      status,
      issues,
      recommendations,
      stats,
    };

    errorLogger.info("Cache health check completed", {
      status,
      issueCount: issues.length,
      recommendationCount: recommendations.length,
    });

    return healthCheck;
  }

  // Cache warming utilities

  // Warm cache with common data
  static async warmCache(
    dataLoaders: Array<{
      key: string;
      loader: () => Promise<any>;
      ttl?: number;
    }>
  ): Promise<{
    successful: number;
    failed: number;
    errors: string[];
  }> {
    const results = {
      successful: 0,
      failed: 0,
      errors: [] as string[],
    };

    errorLogger.info("Starting cache warming", {
      itemCount: dataLoaders.length,
    });

    for (const { key, loader, ttl } of dataLoaders) {
      try {
        // Check if already cached
        if (cacheService.has(key)) {
          results.successful++;
          continue;
        }

        const data = await loader();
        cacheService.set(key, data, ttl);
        results.successful++;
      } catch (error) {
        results.failed++;
        const errorMsg = `Failed to warm cache for ${key}: ${error instanceof Error ? error.message : "Unknown error"}`;
        results.errors.push(errorMsg);
        errorLogger.error("Cache warming failed", { key, error });
      }
    }

    errorLogger.info("Cache warming completed", {
      successful: results.successful,
      failed: results.failed,
      errorCount: results.errors.length,
    });

    return results;
  }

  // Cache migration utilities

  // Migrate cache data with new format
  static migrateCacheData<migrationResult>(
    migrationFn: (key: string, data: any) => Promise<migrationResult>,
    keyPattern?: RegExp
  ): Promise<{
    migrated: number;
    failed: number;
    errors: string[];
  }> {
    return new Promise((resolve) => {
      const results = {
        migrated: 0,
        failed: 0,
        errors: [] as string[],
      };

      const keys = cacheService.getKeys();
      const keysToMigrate = keyPattern
        ? keys.filter((key) => keyPattern.test(key))
        : keys;

      errorLogger.info("Starting cache migration", {
        totalKeys: keys.length,
        keysToMigrate: keysToMigrate.length,
      });

      const migrationPromises = keysToMigrate.map(async (key) => {
        try {
          const entry = cacheService.getEntry(key);
          if (!entry) return;

          const migratedData = await migrationFn(key, entry.data);
          cacheService.set(key, migratedData, entry.ttl, entry.metadata);
          results.migrated++;
        } catch (error) {
          results.failed++;
          const errorMsg = `Failed to migrate ${key}: ${error instanceof Error ? error.message : "Unknown error"}`;
          results.errors.push(errorMsg);
          errorLogger.error("Cache migration failed", { key, error });
        }
      });

      Promise.all(migrationPromises).then(() => {
        errorLogger.info("Cache migration completed", {
          migrated: results.migrated,
          failed: results.failed,
          errorCount: results.errors.length,
        });
        resolve(results);
      });
    });
  }

  // Cache analytics

  // Generate cache report
  static generateReport(): {
    summary: any;
    byType: Record<string, any>;
    performance: any;
    health: any;
    recommendations: string[];
  } {
    const stats = cacheManager.getComprehensiveStats();
    const health = this.performHealthCheck();
    const insights = this.getPerformanceInsights();

    const byType = {
      meetings: stats.meetings,
      users: stats.users,
      other: {
        totalEntries:
          stats.general.totalSize -
          stats.meetings.totalEntries -
          stats.users.totalEntries,
      },
    };

    const summary = {
      totalEntries: stats.general.totalSize,
      hitRate: stats.general.hitRate,
      totalHits: stats.general.hits,
      totalMisses: stats.general.misses,
      evictions: stats.general.evictions,
      lastUpdate: Date.now(),
    };

    const recommendations = [
      ...health.recommendations,
      ...insights.recommendations,
    ];

    // Remove duplicates
    const uniqueRecommendations = Array.from(new Set(recommendations));

    const report = {
      summary,
      byType,
      performance: {
        hitRateStatus: insights.hitRateStatus,
        sizeStatus: insights.sizeStatus,
        evictionRate: insights.evictionRate,
        trend: insights.trend,
      },
      health,
      recommendations: uniqueRecommendations,
    };

    errorLogger.info("Cache report generated", {
      totalEntries: summary.totalEntries,
      hitRate: (summary.hitRate * 100).toFixed(2) + "%",
      recommendationCount: uniqueRecommendations.length,
    });

    return report;
  }

  // Get performance insights (alias for cache monitor)
  static getPerformanceInsights() {
    // This would typically import from cache-monitor, but to avoid circular dependencies
    // we'll implement a simplified version here
    const stats = cacheService.getStats();

    const insights = {
      hitRateStatus: "good" as "excellent" | "good" | "poor" | "critical",
      sizeStatus: "normal" as "normal" | "high" | "critical",
      evictionRate: "low" as "low" | "medium" | "high",
      trend: "stable" as "improving" | "stable" | "declining",
      recommendations: [] as string[],
    };

    // Analyze hit rate
    if (stats.hitRate >= 0.8) {
      insights.hitRateStatus = "excellent";
    } else if (stats.hitRate >= 0.6) {
      insights.hitRateStatus = "good";
    } else if (stats.hitRate >= 0.4) {
      insights.hitRateStatus = "poor";
    } else {
      insights.hitRateStatus = "critical";
      insights.recommendations.push(
        "Consider increasing TTL for frequently accessed data"
      );
    }

    // Analyze cache size
    const maxSize = 1000;
    const sizePercentage = (stats.totalSize / maxSize) * 100;
    if (sizePercentage >= 90) {
      insights.sizeStatus = "critical";
      insights.recommendations.push(
        "Cache is near capacity, consider increasing max size"
      );
    } else if (sizePercentage >= 70) {
      insights.sizeStatus = "high";
    }

    // Analyze eviction rate
    const evictionRate = stats.evictions / Math.max(stats.sets, 1);
    if (evictionRate >= 0.3) {
      insights.evictionRate = "high";
      insights.recommendations.push(
        "High eviction rate detected, consider increasing cache size"
      );
    } else if (evictionRate >= 0.1) {
      insights.evictionRate = "medium";
    }

    return insights;
  }
}

// Export convenience functions
export const clearAllCache = () => CacheUtils.clearAllCache();
export const getCacheDebugInfo = () => CacheUtils.getDebugInfo();
export const performCacheHealthCheck = () => CacheUtils.performHealthCheck();
export const generateCacheReport = () => CacheUtils.generateReport();
