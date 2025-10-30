import type { CacheConfig } from "./cache-service";

// Default cache configuration
export const DEFAULT_CACHE_CONFIG: Partial<CacheConfig> = {
  defaultTTL: 5 * 60 * 1000, // 5 minutes
  maxSize: 1000,
  cleanupInterval: 60 * 1000, // 1 minute
  enablePersistence: true,
  persistenceKey: "gomeet_cache",
  enableLogging: true,
};

// Environment-specific configurations
export const ENVIRONMENT_CONFIGS = {
  development: {
    ...DEFAULT_CACHE_CONFIG,
    defaultTTL: 2 * 60 * 1000, // 2 minutes for development
    maxSize: 500,
    enableLogging: true,
    enablePersistence: false, // Disable persistence in development
  },
  staging: {
    ...DEFAULT_CACHE_CONFIG,
    defaultTTL: 5 * 60 * 1000, // 5 minutes
    maxSize: 800,
    enableLogging: true,
    enablePersistence: true,
  },
  production: {
    ...DEFAULT_CACHE_CONFIG,
    defaultTTL: 10 * 60 * 1000, // 10 minutes for production
    maxSize: 2000,
    cleanupInterval: 30 * 1000, // 30 seconds
    enableLogging: false, // Disable verbose logging in production
    enablePersistence: true,
  },
} as const;

// Feature-specific TTL configurations
export const FEATURE_TTL = {
  // Meeting data
  MEETING_DETAIL: 10 * 60 * 1000, // 10 minutes
  MEETING_LIST: 5 * 60 * 1000, // 5 minutes
  MEETING_PARTICIPANTS: 2 * 60 * 1000, // 2 minutes
  MEETING_PUBLIC: 10 * 60 * 1000, // 10 minutes

  // User data
  USER_PROFILE: 30 * 60 * 1000, // 30 minutes
  USER_CURRENT: 15 * 60 * 1000, // 15 minutes
  PUBLIC_USER: 60 * 60 * 1000, // 1 hour

  // Application data
  APP_CONFIG: 24 * 60 * 60 * 1000, // 24 hours
  FEATURE_FLAGS: 5 * 60 * 1000, // 5 minutes

  // Temporary data
  TEMPORARY: 30 * 1000, // 30 seconds
  SESSION: 60 * 60 * 1000, // 1 hour
} as const;

// Cache size limits by feature type
export const CACHE_SIZE_LIMITS = {
  MEETING_DETAIL: 100,
  MEETING_LIST: 50,
  MEETING_PARTICIPANTS: 200,
  USER_PROFILE: 500,
  PUBLIC_USER: 300,
  APP_CONFIG: 10,
  FEATURE_FLAGS: 5,
} as const;

// Cache invalidation strategies
export const INVALIDATION_STRATEGIES = {
  // Time-based invalidation
  TIME_BASED: "time_based",

  // Event-based invalidation
  EVENT_BASED: "event_based",

  // Manual invalidation
  MANUAL: "manual",

  // Hybrid approach
  HYBRID: "hybrid",
} as const;

// Cache warming configurations
export const CACHE_WARMING_CONFIG = {
  enabled: true,
  priority: ["user:current", "meeting:list:default", "app:config"],
  batchSize: 10,
  retryAttempts: 3,
  retryDelay: 1000,
} as const;

// Cache monitoring configuration
export const MONITORING_CONFIG = {
  enabled: true,
  refreshInterval: 5000, // 5 seconds
  historySize: 100,
  alertThresholds: {
    hitRate: 0.4, // Alert if hit rate falls below 40%
    evictionRate: 0.3, // Alert if eviction rate exceeds 30%
    sizeUsage: 0.9, // Alert if cache is 90% full
  },
  performanceTracking: {
    enabled: true,
    sampleSize: 100,
    reportInterval: 60 * 1000, // 1 minute
  },
} as const;

// Cache debugging configuration
export const DEBUG_CONFIG = {
  enabled: process.env.NODE_ENV === "development",
  logLevel: "debug" as "debug" | "info" | "warn" | "error",
  includeStackTrace: true,
  performanceProfiling: true,
  cacheEvents: true,
} as const;

// Get environment-specific configuration
export function getCacheConfig(environment?: string): Partial<CacheConfig> {
  const env = environment || process.env.NODE_ENV || "development";

  switch (env) {
    case "production":
      return ENVIRONMENT_CONFIGS.production;
    case "staging":
      return ENVIRONMENT_CONFIGS.staging;
    case "development":
    default:
      return ENVIRONMENT_CONFIGS.development;
  }
}

// Get TTL for specific feature
export function getFeatureTTL(feature: keyof typeof FEATURE_TTL): number {
  return FEATURE_TTL[feature];
}

// Get cache size limit for specific feature
export function getFeatureSizeLimit(
  feature: keyof typeof CACHE_SIZE_LIMITS
): number {
  return CACHE_SIZE_LIMITS[feature];
}

// Validate cache configuration
export function validateCacheConfig(config: Partial<CacheConfig>): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate TTL
  if (config.defaultTTL !== undefined) {
    if (config.defaultTTL <= 0) {
      errors.push("Default TTL must be greater than 0");
    } else if (config.defaultTTL > 24 * 60 * 60 * 1000) {
      warnings.push("Default TTL is very large ( > 24 hours)");
    }
  }

  // Validate max size
  if (config.maxSize !== undefined) {
    if (config.maxSize <= 0) {
      errors.push("Max size must be greater than 0");
    } else if (config.maxSize > 10000) {
      warnings.push("Max size is very large ( > 10000 entries)");
    }
  }

  // Validate cleanup interval
  if (config.cleanupInterval !== undefined) {
    if (config.cleanupInterval <= 0) {
      errors.push("Cleanup interval must be greater than 0");
    } else if (config.cleanupInterval < 1000) {
      warnings.push("Cleanup interval is very frequent ( < 1 second)");
    }
  }

  // Validate persistence key
  if (config.persistenceKey !== undefined) {
    if (!config.persistenceKey || config.persistenceKey.trim() === "") {
      errors.push("Persistence key cannot be empty");
    } else if (config.persistenceKey.length > 100) {
      warnings.push("Persistence key is very long");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

// Merge configurations with validation
export function createCacheConfig(
  baseConfig: Partial<CacheConfig> = {},
  environment?: string
): Partial<CacheConfig> {
  const envConfig = getCacheConfig(environment);
  const mergedConfig = { ...DEFAULT_CACHE_CONFIG, ...envConfig, ...baseConfig };

  const validation = validateCacheConfig(mergedConfig);

  if (!validation.isValid) {
    console.error("Invalid cache configuration:", validation.errors);
    throw new Error(
      `Invalid cache configuration: ${validation.errors.join(", ")}`
    );
  }

  if (validation.warnings.length > 0) {
    console.warn("Cache configuration warnings:", validation.warnings);
  }

  return mergedConfig;
}

// Export configuration utilities
export const cacheConfigUtils = {
  getCacheConfig,
  getFeatureTTL,
  getFeatureSizeLimit,
  validateCacheConfig,
  createCacheConfig,
};
