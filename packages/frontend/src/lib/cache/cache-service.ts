import { browser } from "$app/environment";
import { errorLogger } from "$lib/errors";

// Cache entry interface
export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
  key: string;
  metadata?: Record<string, any>;
}

// Cache statistics interface
export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  totalSize: number;
  hitRate: number;
}

// Cache configuration interface
export interface CacheConfig {
  defaultTTL: number; // in milliseconds
  maxSize: number; // maximum number of entries
  cleanupInterval: number; // cleanup interval in milliseconds
  enablePersistence: boolean;
  persistenceKey: string;
  enableLogging: boolean;
}

// Cache event types
export type CacheEventType =
  | "hit"
  | "miss"
  | "set"
  | "delete"
  | "evict"
  | "cleanup"
  | "clear";

// Cache event interface
export interface CacheEvent {
  type: CacheEventType;
  key: string;
  timestamp: number;
  data?: any;
  ttl?: number;
  reason?: string;
  metadata?: Record<string, any>;
}

// Cache service class
export class CacheService {
  private cache: Map<string, CacheEntry> = new Map();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
    totalSize: 0,
    hitRate: 0,
  };
  private config: CacheConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private eventListeners: Map<
    CacheEventType,
    Array<(event: CacheEvent) => void>
  > = new Map();

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      defaultTTL: 5 * 60 * 1000, // 5 minutes
      maxSize: 1000,
      cleanupInterval: 60 * 1000, // 1 minute
      enablePersistence: true,
      persistenceKey: "gomeet_cache",
      enableLogging: true,
      ...config,
    };

    this.initialize();
  }

  // Initialize cache service
  private initialize(): void {
    if (!browser) return;

    // Load persisted cache if enabled
    if (this.config.enablePersistence) {
      this.loadPersistedCache();
    }

    // Start cleanup timer
    this.startCleanupTimer();

    // Initialize event listeners
    this.initializeEventListeners();

    this.logEvent("cache_initialized", {
      config: this.config,
      initialSize: this.cache.size,
    });
  }

  // Get data from cache
  get<T = any>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      this.logEvent("miss", { key });
      this.emitEvent({ type: "miss", key, timestamp: Date.now() });
      return null;
    }

    // Check if entry is expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      this.logEvent("miss", { key, reason: "expired" });
      this.emitEvent({
        type: "evict",
        key,
        timestamp: Date.now(),
        reason: "expired",
      });
      return null;
    }

    this.stats.hits++;
    this.updateHitRate();
    this.logEvent("hit", { key, ttl: entry.ttl });
    this.emitEvent({
      type: "hit",
      key,
      timestamp: Date.now(),
      data: entry.data,
    });

    return entry.data as T;
  }

  // Set data in cache
  set<T = any>(
    key: string,
    data: T,
    ttl?: number,
    metadata?: Record<string, any>
  ): void {
    const actualTTL = ttl || this.config.defaultTTL;
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: actualTTL,
      key,
      metadata,
    };

    // Check if we need to evict entries
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, entry);
    this.stats.sets++;
    this.stats.totalSize = this.cache.size;

    this.logEvent("set", { key, ttl: actualTTL, size: this.cache.size });
    this.emitEvent({
      type: "set",
      key,
      timestamp: Date.now(),
      data,
      ttl: actualTTL,
      metadata,
    });

    // Persist cache if enabled
    if (this.config.enablePersistence) {
      this.persistCache();
    }
  }

  // Delete specific key
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);

    if (deleted) {
      this.stats.deletes++;
      this.stats.totalSize = this.cache.size;
      this.logEvent("delete", { key });
      this.emitEvent({ type: "delete", key, timestamp: Date.now() });

      if (this.config.enablePersistence) {
        this.persistCache();
      }
    }

    return deleted;
  }

  // Clear all cache
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.totalSize = 0;

    this.logEvent("clear", { previousSize: size });
    this.emitEvent({ type: "clear", key: "*", timestamp: Date.now() });

    if (this.config.enablePersistence) {
      this.clearPersistedCache();
    }
  }

  // Check if key exists and is not expired
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.evictions++;
      return false;
    }

    return true;
  }

  // Get remaining TTL for a key
  getTTL(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const remaining = entry.ttl - (Date.now() - entry.timestamp);
    return remaining > 0 ? remaining : 0;
  }

  // Update TTL for existing key
  updateTTL(key: string, newTTL: number): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    entry.ttl = newTTL;
    entry.timestamp = Date.now();

    this.logEvent("ttl_updated", { key, newTTL });

    if (this.config.enablePersistence) {
      this.persistCache();
    }

    return true;
  }

  // Get cache statistics
  getStats(): CacheStats {
    this.updateHitRate();
    return { ...this.stats };
  }

  // Get all cache keys (for debugging)
  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  // Get cache size
  size(): number {
    return this.cache.size;
  }

  // Force cleanup of expired entries
  cleanup(): number {
    const initialSize = this.cache.size;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        this.stats.evictions++;
      }
    }

    this.stats.totalSize = this.cache.size;
    const cleanedCount = initialSize - this.cache.size;

    if (cleanedCount > 0) {
      this.logEvent("cleanup", { cleanedCount, totalSize: this.cache.size });
      this.emitEvent({
        type: "cleanup",
        key: "*",
        timestamp: Date.now(),
        reason: `cleaned ${cleanedCount} entries`,
      });

      if (this.config.enablePersistence) {
        this.persistCache();
      }
    }

    return cleanedCount;
  }

  // Add event listener
  addEventListener(
    eventType: CacheEventType,
    listener: (event: CacheEvent) => void
  ): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)!.push(listener);
  }

  // Remove event listener
  removeEventListener(
    eventType: CacheEventType,
    listener: (event: CacheEvent) => void
  ): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  // Invalidate cache by pattern
  invalidateByPattern(pattern: RegExp): number {
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.delete(key));

    this.logEvent("invalidate_by_pattern", {
      pattern: pattern.toString(),
      deletedCount: keysToDelete.length,
    });

    return keysToDelete.length;
  }

  // Get cache entry with metadata
  getEntry<T = any>(key: string): CacheEntry<T> | null {
    const entry = this.cache.get(key);
    if (!entry || this.isExpired(entry)) {
      return null;
    }
    return entry as CacheEntry<T>;
  }

  // Private methods

  // Check if entry is expired
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  // Evict least recently used entry
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
      this.logEvent("evict", { key: oldestKey, reason: "lru" });
      this.emitEvent({
        type: "evict",
        key: oldestKey,
        timestamp: Date.now(),
        reason: "lru",
      });
    }
  }

  // Update hit rate
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  // Start cleanup timer
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  // Initialize event listeners
  private initializeEventListeners(): void {
    // Add default logging listener
    this.addEventListener("hit", (event) => {
      if (this.config.enableLogging) {
        errorLogger.debug("Cache hit", { key: event.key });
      }
    });

    this.addEventListener("miss", (event) => {
      if (this.config.enableLogging) {
        errorLogger.debug("Cache miss", {
          key: event.key,
          reason: event.reason,
        });
      }
    });

    this.addEventListener("evict", (event) => {
      if (this.config.enableLogging) {
        errorLogger.info("Cache eviction", {
          key: event.key,
          reason: event.reason,
        });
      }
    });
  }

  // Emit event to listeners
  private emitEvent(event: CacheEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          errorLogger.error("Cache event listener error", { error, event });
        }
      });
    }
  }

  // Log cache events
  private logEvent(action: string, data?: Record<string, any>): void {
    if (this.config.enableLogging) {
      errorLogger.debug(`Cache: ${action}`, {
        cacheSize: this.cache.size,
        stats: this.stats,
        ...data,
      });
    }
  }

  // Persistence methods

  // Load persisted cache from localStorage
  private loadPersistedCache(): void {
    try {
      const persistedData = localStorage.getItem(this.config.persistenceKey);
      if (persistedData) {
        const parsed = JSON.parse(persistedData);
        const now = Date.now();

        // Only load non-expired entries
        for (const [key, entry] of Object.entries(parsed.cache || {})) {
          const cacheEntry = entry as CacheEntry;
          if (now - cacheEntry.timestamp <= cacheEntry.ttl) {
            this.cache.set(key, cacheEntry);
          }
        }

        this.stats.totalSize = this.cache.size;
        this.logEvent("persisted_cache_loaded", {
          loadedEntries: this.cache.size,
          totalEntries: Object.keys(parsed.cache || {}).length,
        });
      }
    } catch (error) {
      errorLogger.error("Failed to load persisted cache", { error });
    }
  }

  // Persist cache to localStorage
  private persistCache(): void {
    try {
      const cacheObject: Record<string, CacheEntry> = {};
      for (const [key, entry] of this.cache.entries()) {
        cacheObject[key] = entry;
      }

      const persistData = {
        cache: cacheObject,
        timestamp: Date.now(),
        version: "1.0",
      };

      localStorage.setItem(
        this.config.persistenceKey,
        JSON.stringify(persistData)
      );
    } catch (error) {
      errorLogger.error("Failed to persist cache", { error });
    }
  }

  // Clear persisted cache
  private clearPersistedCache(): void {
    try {
      localStorage.removeItem(this.config.persistenceKey);
    } catch (error) {
      errorLogger.error("Failed to clear persisted cache", { error });
    }
  }

  // Destroy cache service
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.clear();
    this.eventListeners.clear();
  }
}

// Create singleton instance with default configuration
export const cacheService = new CacheService({
  defaultTTL: 5 * 60 * 1000, // 5 minutes
  maxSize: 1000,
  cleanupInterval: 60 * 1000, // 1 minute
  enablePersistence: true,
  persistenceKey: "gomeet_cache",
  enableLogging: true,
});
