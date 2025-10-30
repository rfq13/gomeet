import { errorLogger } from "$lib/errors/logger";

/**
 * Audio Context Pool Service
 *
 * Service ini mengelola AudioContext instances secara efisien untuk mencegah
 * memory leaks dan mengoptimalkan penggunaan resources dalam aplikasi WebRTC.
 */

export interface AudioContextConfig {
  sampleRate?: number;
  latencyHint?: AudioContextLatencyCategory;
  sinkId?: string;
}

export interface PooledAudioContext {
  id: string;
  context: AudioContext;
  createdAt: number;
  lastUsedAt: number;
  refCount: number;
  isDestroyed: boolean;
  config: AudioContextConfig;
}

export interface AudioContextPoolOptions {
  maxPoolSize?: number;
  maxContextAge?: number; // in milliseconds
  cleanupInterval?: number; // in milliseconds
  enableMonitoring?: boolean;
  enableLogging?: boolean;
}

export interface AudioContextStats {
  totalContexts: number;
  activeContexts: number;
  idleContexts: number;
  destroyedContexts: number;
  averageAge: number;
  memoryUsage: number;
}

export class AudioContextPool {
  private pool: Map<string, PooledAudioContext> = new Map();
  private configToContextId: Map<string, string> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;

  private readonly maxPoolSize: number;
  private readonly maxContextAge: number;
  private readonly cleanupInterval: number;
  private readonly enableMonitoring: boolean;
  private readonly enableLogging: boolean;

  // Monitoring statistics
  private stats = {
    created: 0,
    reused: 0,
    destroyed: 0,
    cleanupRuns: 0,
    memoryLeaksPrevented: 0,
  };

  constructor(options: AudioContextPoolOptions = {}) {
    this.maxPoolSize = options.maxPoolSize ?? 10;
    this.maxContextAge = options.maxContextAge ?? 5 * 60 * 1000; // 5 menit
    this.cleanupInterval = options.cleanupInterval ?? 30 * 1000; // 30 detik
    this.enableMonitoring = options.enableMonitoring ?? true;
    this.enableLogging = options.enableLogging ?? true;

    this.logInfo("AudioContextPool initialized", {
      maxPoolSize: this.maxPoolSize,
      maxContextAge: this.maxContextAge,
      cleanupInterval: this.cleanupInterval,
    });

    // Start cleanup timer
    this.startCleanupTimer();
  }

  /**
   * Mendapatkan atau membuat AudioContext dari pool
   */
  async acquire(config: AudioContextConfig = {}): Promise<PooledAudioContext> {
    if (this.isDestroyed) {
      throw new Error("AudioContextPool has been destroyed");
    }

    const configKey = this.getConfigKey(config);
    const existingContextId = this.configToContextId.get(configKey);

    // Check for reusable context
    if (existingContextId) {
      const existingContext = this.pool.get(existingContextId);
      if (
        existingContext &&
        !existingContext.isDestroyed &&
        this.isContextUsable(existingContext)
      ) {
        existingContext.refCount++;
        existingContext.lastUsedAt = Date.now();
        this.stats.reused++;

        this.logInfo("Reusing existing AudioContext", {
          contextId: existingContext.id,
          refCount: existingContext.refCount,
          config,
        });

        return existingContext;
      }
    }

    // Create new context if pool not full
    if (this.pool.size >= this.maxPoolSize) {
      await this.cleanupOldContexts();

      if (this.pool.size >= this.maxPoolSize) {
        throw new Error(`AudioContextPool is full (max: ${this.maxPoolSize})`);
      }
    }

    // Create new AudioContext
    const context = await this.createAudioContext(config);
    const pooledContext: PooledAudioContext = {
      id: this.generateContextId(),
      context,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      refCount: 1,
      isDestroyed: false,
      config,
    };

    this.pool.set(pooledContext.id, pooledContext);
    this.configToContextId.set(configKey, pooledContext.id);
    this.stats.created++;

    this.logInfo("Created new AudioContext", {
      contextId: pooledContext.id,
      config,
      poolSize: this.pool.size,
    });

    return pooledContext;
  }

  /**
   * Melepaskan AudioContext kembali ke pool
   */
  release(contextId: string): void {
    const pooledContext = this.pool.get(contextId);
    if (!pooledContext) {
      this.logWarn("Attempted to release unknown context", { contextId });
      return;
    }

    if (pooledContext.refCount <= 0) {
      this.logWarn("Attempted to release context with refCount <= 0", {
        contextId,
        refCount: pooledContext.refCount,
      });
      return;
    }

    pooledContext.refCount--;
    pooledContext.lastUsedAt = Date.now();

    this.logInfo("Released AudioContext", {
      contextId,
      refCount: pooledContext.refCount,
    });

    // Auto-cleanup if no references
    if (pooledContext.refCount === 0) {
      this.scheduleContextCleanup(contextId);
    }
  }

  /**
   * Menghancurkan AudioContext secara permanen
   */
  async destroyContext(contextId: string): Promise<void> {
    const pooledContext = this.pool.get(contextId);
    if (!pooledContext) {
      return;
    }

    await this.destroyPooledContext(pooledContext);
  }

  /**
   * Mendapatkan statistik penggunaan pool
   */
  getStats(): AudioContextStats {
    const contexts = Array.from(this.pool.values());
    const activeContexts = contexts.filter((ctx) => ctx.refCount > 0);
    const idleContexts = contexts.filter(
      (ctx) => ctx.refCount === 0 && !ctx.isDestroyed
    );
    const destroyedContexts = contexts.filter((ctx) => ctx.isDestroyed);

    const now = Date.now();
    const averageAge =
      contexts.length > 0
        ? contexts.reduce((sum, ctx) => sum + (now - ctx.createdAt), 0) /
          contexts.length
        : 0;

    // Estimate memory usage (rough approximation)
    const memoryUsage = contexts.length * 10 * 1024 * 1024; // ~10MB per context

    return {
      totalContexts: contexts.length,
      activeContexts: activeContexts.length,
      idleContexts: idleContexts.length,
      destroyedContexts: destroyedContexts.length,
      averageAge,
      memoryUsage,
    };
  }

  /**
   * Mendapatkan detailed monitoring statistics
   */
  getDetailedStats() {
    return {
      ...this.getStats(),
      pool: {
        created: this.stats.created,
        reused: this.stats.reused,
        destroyed: this.stats.destroyed,
        cleanupRuns: this.stats.cleanupRuns,
        memoryLeaksPrevented: this.stats.memoryLeaksPrevented,
      },
      contexts: Array.from(this.pool.values()).map((ctx) => ({
        id: ctx.id,
        refCount: ctx.refCount,
        isDestroyed: ctx.isDestroyed,
        age: Date.now() - ctx.createdAt,
        lastUsed: Date.now() - ctx.lastUsedAt,
        state: ctx.context.state,
      })),
    };
  }

  /**
   * Force cleanup semua contexts
   */
  async forceCleanup(): Promise<void> {
    this.logInfo("Force cleanup initiated");
    await this.cleanupOldContexts();
  }

  /**
   * Menghancurkan pool dan semua resources
   */
  async destroy(): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;
    this.logInfo("Destroying AudioContextPool");

    // Stop cleanup timer
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Destroy all contexts
    const destroyPromises = Array.from(this.pool.values()).map((ctx) =>
      this.destroyPooledContext(ctx)
    );

    await Promise.all(destroyPromises);

    // Clear mappings
    this.pool.clear();
    this.configToContextId.clear();

    this.logInfo("AudioContextPool destroyed", {
      finalStats: this.stats,
    });
  }

  /**
   * Membuat AudioContext baru dengan konfigurasi yang diberikan
   */
  private async createAudioContext(
    config: AudioContextConfig
  ): Promise<AudioContext> {
    try {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;

      const contextOptions: AudioContextOptions = {
        sampleRate: config.sampleRate,
        latencyHint: config.latencyHint,
      };

      const context = new AudioContextClass(contextOptions);

      // Handle context state changes
      context.addEventListener("statechange", () => {
        this.logInfo("AudioContext state changed", {
          state: context.state,
          contextId: this.findContextIdByContext(context),
        });
      });

      // Set sink ID if provided (experimental API)
      if (
        config.sinkId &&
        "setSinkId" in context &&
        typeof (context as any).setSinkId === "function"
      ) {
        try {
          await (context as any).setSinkId(config.sinkId);
        } catch (error) {
          this.logWarn("Failed to set sink ID", {
            sinkId: config.sinkId,
            error,
          });
        }
      }

      return context;
    } catch (error) {
      this.logError("Failed to create AudioContext", { config, error });
      throw error;
    }
  }

  /**
   * Menghancurkan pooled context
   */
  private async destroyPooledContext(
    pooledContext: PooledAudioContext
  ): Promise<void> {
    if (pooledContext.isDestroyed) {
      return;
    }

    try {
      // Close AudioContext
      if (pooledContext.context.state !== "closed") {
        await pooledContext.context.close();
      }

      // Mark as destroyed
      pooledContext.isDestroyed = true;
      this.stats.destroyed++;

      // Remove from mappings
      this.configToContextId.delete(this.getConfigKey(pooledContext.config));
      this.pool.delete(pooledContext.id);

      this.logInfo("AudioContext destroyed", {
        contextId: pooledContext.id,
        age: Date.now() - pooledContext.createdAt,
      });
    } catch (error) {
      this.logError("Error destroying AudioContext", {
        contextId: pooledContext.id,
        error,
      });
    }
  }

  /**
   * Memeriksa apakah context masih dapat digunakan
   */
  private isContextUsable(pooledContext: PooledAudioContext): boolean {
    const context = pooledContext.context;

    // Check if context is not closed
    if (context.state === "closed") {
      return false;
    }

    // Check if context is too old
    if (Date.now() - pooledContext.createdAt > this.maxContextAge) {
      return false;
    }

    return true;
  }

  /**
   * Membersihkan contexts yang lama atau tidak digunakan
   */
  private async cleanupOldContexts(): Promise<void> {
    const now = Date.now();
    const contextsToCleanup: string[] = [];

    for (const [id, pooledContext] of this.pool) {
      if (pooledContext.isDestroyed) {
        contextsToCleanup.push(id);
        continue;
      }

      // Cleanup old contexts with no references
      if (
        pooledContext.refCount === 0 &&
        (now - pooledContext.lastUsedAt > this.maxContextAge ||
          now - pooledContext.createdAt > this.maxContextAge)
      ) {
        contextsToCleanup.push(id);
      }
    }

    if (contextsToCleanup.length > 0) {
      this.logInfo("Cleaning up old contexts", {
        count: contextsToCleanup.length,
        contextIds: contextsToCleanup,
      });

      for (const contextId of contextsToCleanup) {
        await this.destroyContext(contextId);
        this.stats.memoryLeaksPrevented++;
      }

      this.stats.cleanupRuns++;
    }
  }

  /**
   * Menjadwalkan cleanup untuk context tertentu
   */
  private scheduleContextCleanup(contextId: string): void {
    setTimeout(() => {
      const pooledContext = this.pool.get(contextId);
      if (
        pooledContext &&
        pooledContext.refCount === 0 &&
        !pooledContext.isDestroyed
      ) {
        this.destroyContext(contextId);
      }
    }, this.maxContextAge);
  }

  /**
   * Memulai cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => {
        if (!this.isDestroyed) {
          this.cleanupOldContexts();
        }
      }, this.cleanupInterval);
    }
  }

  /**
   * Generate unique context ID
   */
  private generateContextId(): string {
    return `audio_ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate config key for caching
   */
  private getConfigKey(config: AudioContextConfig): string {
    return JSON.stringify({
      sampleRate: config.sampleRate,
      latencyHint: config.latencyHint,
      sinkId: config.sinkId,
    });
  }

  /**
   * Find context ID by AudioContext instance
   */
  private findContextIdByContext(context: AudioContext): string | null {
    for (const [id, pooledContext] of this.pool) {
      if (pooledContext.context === context) {
        return id;
      }
    }
    return null;
  }

  /**
   * Logging methods
   */
  private logInfo(message: string, data?: any): void {
    if (this.enableLogging) {
      errorLogger.info(`[AudioContextPool] ${message}`, data);
    }
  }

  private logWarn(message: string, data?: any): void {
    if (this.enableLogging) {
      errorLogger.warn(`[AudioContextPool] ${message}`, data);
    }
  }

  private logError(message: string, data?: any): void {
    if (this.enableLogging) {
      errorLogger.error(`[AudioContextPool] ${message}`, data);
    }
  }
}

// Singleton instance
let audioContextPoolInstance: AudioContextPool | null = null;

/**
 * Get or create AudioContextPool singleton instance
 */
export function getAudioContextPool(
  options?: AudioContextPoolOptions
): AudioContextPool {
  if (!audioContextPoolInstance) {
    audioContextPoolInstance = new AudioContextPool(options);
  }
  return audioContextPoolInstance;
}

/**
 * Destroy AudioContextPool singleton instance
 */
export function destroyAudioContextPool(): Promise<void> {
  if (audioContextPoolInstance) {
    const pool = audioContextPoolInstance;
    audioContextPoolInstance = null;
    return pool.destroy();
  }
  return Promise.resolve();
}

/**
 * Factory function untuk membuat AudioContextPool dengan konfigurasi default
 */
export function createAudioContextPool(
  options?: AudioContextPoolOptions
): AudioContextPool {
  return new AudioContextPool({
    maxPoolSize: 10,
    maxContextAge: 5 * 60 * 1000, // 5 menit
    cleanupInterval: 30 * 1000, // 30 detik
    enableMonitoring: true,
    enableLogging: true,
    ...options,
  });
}
