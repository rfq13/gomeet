// Cache module exports
export { CacheService, cacheService } from "./cache-service";
export {
  CacheManager,
  cacheManager,
  CACHE_KEYS,
  CACHE_TTL,
  INVALIDATION_PATTERNS,
} from "./cache-manager";
export {
  cacheMonitorStore,
  getCacheInsights,
  exportCacheData,
} from "./cache-monitor";
export {
  CacheUtils,
  clearAllCache,
  getCacheDebugInfo,
  performCacheHealthCheck,
  generateCacheReport,
} from "./cache-utils";
export {
  DEFAULT_CACHE_CONFIG,
  ENVIRONMENT_CONFIGS,
  FEATURE_TTL,
  CACHE_SIZE_LIMITS,
  getCacheConfig,
  getFeatureTTL,
  getFeatureSizeLimit,
  validateCacheConfig,
  createCacheConfig,
  cacheConfigUtils,
} from "./cache-config";

// Export types
export type {
  CacheEntry,
  CacheStats,
  CacheConfig,
  CacheEvent,
  CacheEventType,
} from "./cache-service";

export type { CacheMonitorState, CacheHistoryEntry } from "./cache-monitor";
