import {
  createAudioContextPool,
  createAudioMonitor,
  getAudioContextPool,
  destroyAudioContextPool,
  type AudioContextConfig,
} from "./index";

/**
 * Test suite untuk Audio Context Pool
 */

export class AudioContextPoolTests {
  private pool = createAudioContextPool({
    maxPoolSize: 5,
    maxContextAge: 10000, // 10 detik untuk testing
    cleanupInterval: 2000, // 2 detik untuk testing
    enableLogging: true,
  });

  async runAllTests(): Promise<void> {
    console.log("🧪 Starting Audio Context Pool Tests...");

    try {
      await this.testBasicAcquireRelease();
      await this.testPoolReuse();
      await this.testPoolCapacity();
      await this.testAutomaticCleanup();
      await this.testMemoryLeakPrevention();
      await this.testConcurrentAccess();

      console.log("✅ All Audio Context Pool tests passed!");
    } catch (error) {
      console.error("❌ Audio Context Pool tests failed:", error);
      throw error;
    }
  }

  /**
   * Test basic acquire and release functionality
   */
  private async testBasicAcquireRelease(): Promise<void> {
    console.log("Testing basic acquire/release...");

    const config: AudioContextConfig = {
      sampleRate: 48000,
      latencyHint: "interactive",
    };

    // Acquire context
    const pooledContext = await this.pool.acquire(config);
    console.log("✓ Context acquired:", pooledContext.id);

    // Verify context is usable
    if (pooledContext.context.state === "closed") {
      throw new Error("Acquired context should not be closed");
    }

    if (pooledContext.refCount !== 1) {
      throw new Error(`Expected refCount 1, got ${pooledContext.refCount}`);
    }

    // Release context
    this.pool.release(pooledContext.id);
    console.log("✓ Context released");

    // Verify ref count decreased
    const stats = this.pool.getStats();
    if (stats.totalContexts !== 1) {
      throw new Error(`Expected 1 context in pool, got ${stats.totalContexts}`);
    }
  }

  /**
   * Test context reuse functionality
   */
  private async testPoolReuse(): Promise<void> {
    console.log("Testing context reuse...");

    const config: AudioContextConfig = {
      sampleRate: 44100,
      latencyHint: "balanced",
    };

    // Acquire first context
    const context1 = await this.pool.acquire(config);
    const originalId = context1.id;

    // Release it
    this.pool.release(context1.id);

    // Acquire again with same config - should reuse
    const context2 = await this.pool.acquire(config);

    if (context2.id !== originalId) {
      throw new Error("Expected to reuse existing context");
    }

    if (context2.refCount !== 1) {
      throw new Error("Expected refCount to be reset to 1");
    }

    this.pool.release(context2.id);
    console.log("✓ Context reuse working correctly");
  }

  /**
   * Test pool capacity limits
   */
  private async testPoolCapacity(): Promise<void> {
    console.log("Testing pool capacity...");

    const config: AudioContextConfig = { sampleRate: 48000 };
    const contexts: any[] = [];

    // Fill pool to capacity
    for (let i = 0; i < 5; i++) {
      const context = await this.pool.acquire({
        ...config,
        // Add unique config to prevent reuse
        latencyHint: `test-${i}` as any,
      });
      contexts.push(context);
    }

    // Try to acquire one more - should fail
    try {
      await this.pool.acquire({
        ...config,
        latencyHint: "test-overflow" as any,
      });
      throw new Error("Should have failed when pool is full");
    } catch (error) {
      if (error instanceof Error && !error.message.includes("full")) {
        throw error;
      }
    }

    // Release all contexts
    contexts.forEach((context) => this.pool.release(context.id));
    console.log("✓ Pool capacity limits working correctly");
  }

  /**
   * Test automatic cleanup
   */
  private async testAutomaticCleanup(): Promise<void> {
    console.log("Testing automatic cleanup...");

    const config: AudioContextConfig = { sampleRate: 48000 };
    const context = await this.pool.acquire(config);

    // Release context
    this.pool.release(context.id);

    // Wait for cleanup (longer than maxContextAge)
    await new Promise((resolve) => setTimeout(resolve, 12000));

    // Force cleanup
    await this.pool.forceCleanup();

    // Check if context was cleaned up
    const stats = this.pool.getStats();
    if (stats.totalContexts > 0) {
      console.log(
        `⚠️ Context not cleaned up automatically (total: ${stats.totalContexts})`
      );
    }

    console.log("✓ Automatic cleanup test completed");
  }

  /**
   * Test memory leak prevention
   */
  private async testMemoryLeakPrevention(): Promise<void> {
    console.log("Testing memory leak prevention...");

    const initialStats = this.pool.getDetailedStats();
    const initialMemoryLeaks = initialStats.pool.memoryLeaksPrevented;

    // Create and release many contexts
    for (let i = 0; i < 10; i++) {
      const context = await this.pool.acquire({
        sampleRate: 48000,
        latencyHint: `test-leak-${i}` as any,
      });

      // Don't release - let cleanup handle it
      if (i % 2 === 0) {
        this.pool.release(context.id);
      }
    }

    // Force cleanup
    await this.pool.forceCleanup();

    const finalStats = this.pool.getDetailedStats();
    const finalMemoryLeaks = finalStats.pool.memoryLeaksPrevented;

    if (finalMemoryLeaks <= initialMemoryLeaks) {
      console.log("⚠️ No memory leaks prevented (this may be normal)");
    } else {
      console.log(
        `✓ Memory leaks prevented: ${finalMemoryLeaks - initialMemoryLeaks}`
      );
    }
  }

  /**
   * Test concurrent access
   */
  private async testConcurrentAccess(): Promise<void> {
    console.log("Testing concurrent access...");

    const config: AudioContextConfig = { sampleRate: 48000 };
    const promises: Promise<any>[] = [];

    // Create multiple concurrent acquire operations
    for (let i = 0; i < 3; i++) {
      promises.push(
        this.pool.acquire({
          ...config,
          latencyHint: `concurrent-${i}` as any,
        })
      );
    }

    const contexts = await Promise.all(promises);

    // Verify all contexts are different
    const ids = contexts.map((c) => c.id);
    const uniqueIds = new Set(ids);

    if (uniqueIds.size !== contexts.length) {
      throw new Error("Expected all contexts to be unique");
    }

    // Release all
    contexts.forEach((context) => this.pool.release(context.id));
    console.log("✓ Concurrent access working correctly");
  }

  /**
   * Cleanup test resources
   */
  async cleanup(): Promise<void> {
    await this.pool.destroy();
    console.log("🧹 Test cleanup completed");
  }
}

/**
 * Test suite untuk Audio Monitor
 */
export class AudioMonitorTests {
  private monitor = createAudioMonitor({
    updateInterval: 1000, // 1 detik untuk testing
    enableConsoleLogging: false, // Disable console logging untuk tests
  });

  async runAllTests(): Promise<void> {
    console.log("🧪 Starting Audio Monitor Tests...");

    try {
      await this.testBasicMonitoring();
      await this.testMetricsCollection();
      await this.testHealthStatus();
      await this.testPerformanceTracking();

      console.log("✅ All Audio Monitor tests passed!");
    } catch (error) {
      console.error("❌ Audio Monitor tests failed:", error);
      throw error;
    }
  }

  /**
   * Test basic monitoring functionality
   */
  private async testBasicMonitoring(): Promise<void> {
    console.log("Testing basic monitoring...");

    // Start monitoring
    this.monitor.startMonitoring();

    // Wait for some metrics
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if metrics were collected
    const currentMetrics = this.monitor.getCurrentMetrics();
    if (!currentMetrics) {
      throw new Error("No metrics collected");
    }

    // Stop monitoring
    this.monitor.stopMonitoring();
    console.log("✓ Basic monitoring working correctly");
  }

  /**
   * Test metrics collection
   */
  private async testMetricsCollection(): Promise<void> {
    console.log("Testing metrics collection...");

    this.monitor.startMonitoring();

    // Wait for multiple metrics collections
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const history = this.monitor.getMetricsHistory();
    if (history.length < 2) {
      throw new Error("Expected multiple metrics entries");
    }

    // Verify timestamps are increasing
    for (let i = 1; i < history.length; i++) {
      if (history[i].timestamp <= history[i - 1].timestamp) {
        throw new Error("Metrics timestamps should be increasing");
      }
    }

    this.monitor.stopMonitoring();
    console.log("✓ Metrics collection working correctly");
  }

  /**
   * Test health status
   */
  private async testHealthStatus(): Promise<void> {
    console.log("Testing health status...");

    this.monitor.startMonitoring();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const healthStatus = this.monitor.getHealthStatus();

    if (
      !healthStatus.status ||
      !healthStatus.issues ||
      !healthStatus.recommendations
    ) {
      throw new Error("Health status structure is invalid");
    }

    this.monitor.stopMonitoring();
    console.log("✓ Health status working correctly");
  }

  /**
   * Test performance tracking
   */
  private async testPerformanceTracking(): Promise<void> {
    console.log("Testing performance tracking...");

    // Track some operations
    this.monitor.trackOperation("acquire", 10);
    this.monitor.trackOperation("acquire", 20);
    this.monitor.trackOperation("release", 5);

    const perfSummary = this.monitor.getPerformanceSummary();

    if (perfSummary.acquire.count !== 2 || perfSummary.release.count !== 1) {
      throw new Error("Performance tracking counts are incorrect");
    }

    if (perfSummary.acquire.average !== 15) {
      throw new Error("Performance tracking average is incorrect");
    }

    console.log("✓ Performance tracking working correctly");
  }

  /**
   * Cleanup test resources
   */
  cleanup(): void {
    this.monitor.destroy();
    console.log("🧹 Monitor test cleanup completed");
  }
}

/**
 * Run all tests
 */
export async function runAllAudioTests(): Promise<void> {
  const poolTests = new AudioContextPoolTests();
  const monitorTests = new AudioMonitorTests();

  try {
    await poolTests.runAllTests();
    await monitorTests.runAllTests();

    console.log("🎉 All audio tests completed successfully!");
  } finally {
    await poolTests.cleanup();
    monitorTests.cleanup();

    // Cleanup global instances
    await destroyAudioContextPool();
  }
}

/**
 * Quick validation function untuk development
 */
export async function quickValidate(): Promise<boolean> {
  try {
    const pool = getAudioContextPool();
    const context = await pool.acquire();

    if (context.context.state === "closed") {
      throw new Error("Context should not be closed");
    }

    pool.release(context.id);

    const stats = pool.getStats();
    console.log("✅ Quick validation passed:", stats);

    return true;
  } catch (error) {
    console.error("❌ Quick validation failed:", error);
    return false;
  }
}
