import {
  cacheService,
  type CacheEvent,
  type CacheEventType,
} from "./cache-service";
import { errorLogger } from "$lib/errors";
import type { Meeting, User, MeetingListResponse, Participant } from "$types";

// Cache key patterns
export const CACHE_KEYS = {
  MEETING_DETAIL: (id: string) => `meeting:detail:${id}`,
  MEETING_LIST: (params?: string) => `meeting:list:${params || "default"}`,
  MEETING_PARTICIPANTS: (id: string) => `meeting:participants:${id}`,
  USER_PROFILE: (id: string) => `user:profile:${id}`,
  USER_CURRENT: "user:current",
  PUBLIC_USER: (sessionId: string) => `public_user:${sessionId}`,
  MEETING_PUBLIC: (id: string) => `meeting:public:${id}`,
} as const;

// TTL configurations (in milliseconds)
export const CACHE_TTL = {
  MEETING_DETAIL: 10 * 60 * 1000, // 10 minutes
  MEETING_LIST: 5 * 60 * 1000, // 5 minutes
  MEETING_PARTICIPANTS: 2 * 60 * 1000, // 2 minutes
  USER_PROFILE: 30 * 60 * 1000, // 30 minutes
  USER_CURRENT: 15 * 60 * 1000, // 15 minutes
  PUBLIC_USER: 60 * 60 * 1000, // 1 hour
  MEETING_PUBLIC: 10 * 60 * 1000, // 10 minutes
} as const;

// Cache invalidation patterns
export const INVALIDATION_PATTERNS = {
  MEETING_DETAIL: /^meeting:detail:/,
  MEETING_LIST: /^meeting:list:/,
  MEETING_PARTICIPANTS: /^meeting:participants:/,
  USER_PROFILE: /^user:profile:/,
  ALL_MEETINGS: /^meeting:/,
  ALL_USERS: /^user:/,
  ALL_PUBLIC_USERS: /^public_user:/,
} as const;

// Cache manager class for specific data types
export class CacheManager {
  // Meeting cache methods

  // Cache meeting detail
  cacheMeetingDetail(meeting: Meeting, customTTL?: number): void {
    const key = CACHE_KEYS.MEETING_DETAIL(meeting.id);
    const ttl = customTTL || CACHE_TTL.MEETING_DETAIL;

    cacheService.set(key, meeting, ttl, {
      type: "meeting_detail",
      meetingId: meeting.id,
      hostId: meeting.hostId,
      isActive: meeting.isActive,
    });

    errorLogger.info("Meeting detail cached", {
      meetingId: meeting.id,
      ttl,
      key,
    });
  }

  // Get cached meeting detail
  getCachedMeetingDetail(id: string): Meeting | null {
    const key = CACHE_KEYS.MEETING_DETAIL(id);
    const meeting = cacheService.get<Meeting>(key);

    if (meeting) {
      errorLogger.debug("Meeting detail retrieved from cache", {
        meetingId: id,
        key,
      });
    }

    return meeting;
  }

  // Cache meeting list
  cacheMeetingList(
    response: MeetingListResponse,
    params?: string,
    customTTL?: number
  ): void {
    const key = CACHE_KEYS.MEETING_LIST(params);
    const ttl = customTTL || CACHE_TTL.MEETING_LIST;

    cacheService.set(key, response, ttl, {
      type: "meeting_list",
      params,
      count: response.meetings.length,
      total: response.pagination.total,
    });

    errorLogger.info("Meeting list cached", {
      params,
      count: response.meetings.length,
      ttl,
      key,
    });
  }

  // Get cached meeting list
  getCachedMeetingList(params?: string): MeetingListResponse | null {
    const key = CACHE_KEYS.MEETING_LIST(params);
    const response = cacheService.get<MeetingListResponse>(key);

    if (response) {
      errorLogger.debug("Meeting list retrieved from cache", {
        params,
        count: response.meetings.length,
        key,
      });
    }

    return response;
  }

  // Cache meeting participants
  cacheMeetingParticipants(
    meetingId: string,
    participants: Participant[],
    customTTL?: number
  ): void {
    const key = CACHE_KEYS.MEETING_PARTICIPANTS(meetingId);
    const ttl = customTTL || CACHE_TTL.MEETING_PARTICIPANTS;

    cacheService.set(key, participants, ttl, {
      type: "meeting_participants",
      meetingId,
      count: participants.length,
    });

    errorLogger.info("Meeting participants cached", {
      meetingId,
      count: participants.length,
      ttl,
      key,
    });
  }

  // Get cached meeting participants
  getCachedMeetingParticipants(meetingId: string): Participant[] | null {
    const key = CACHE_KEYS.MEETING_PARTICIPANTS(meetingId);
    const participants = cacheService.get<Participant[]>(key);

    if (participants) {
      errorLogger.debug("Meeting participants retrieved from cache", {
        meetingId,
        count: participants.length,
        key,
      });
    }

    return participants;
  }

  // Cache public meeting detail
  cacheMeetingPublic(meeting: Meeting, customTTL?: number): void {
    const key = CACHE_KEYS.MEETING_PUBLIC(meeting.id);
    const ttl = customTTL || CACHE_TTL.MEETING_PUBLIC;

    cacheService.set(key, meeting, ttl, {
      type: "meeting_public",
      meetingId: meeting.id,
      hostId: meeting.hostId,
      isActive: meeting.isActive,
    });

    errorLogger.info("Public meeting detail cached", {
      meetingId: meeting.id,
      ttl,
      key,
    });
  }

  // Get cached public meeting detail
  getCachedMeetingPublic(id: string): Meeting | null {
    const key = CACHE_KEYS.MEETING_PUBLIC(id);
    const meeting = cacheService.get<Meeting>(key);

    if (meeting) {
      errorLogger.debug("Public meeting detail retrieved from cache", {
        meetingId: id,
        key,
      });
    }

    return meeting;
  }

  // User cache methods

  // Cache user profile
  cacheUserProfile(user: User, customTTL?: number): void {
    const key = CACHE_KEYS.USER_PROFILE(user.id);
    const ttl = customTTL || CACHE_TTL.USER_PROFILE;

    cacheService.set(key, user, ttl, {
      type: "user_profile",
      userId: user.id,
      username: user.username,
    });

    errorLogger.info("User profile cached", {
      userId: user.id,
      username: user.username,
      ttl,
      key,
    });
  }

  // Get cached user profile
  getCachedUserProfile(id: string): User | null {
    const key = CACHE_KEYS.USER_PROFILE(id);
    const user = cacheService.get<User>(key);

    if (user) {
      errorLogger.debug("User profile retrieved from cache", {
        userId: id,
        username: user.username,
        key,
      });
    }

    return user;
  }

  // Cache current user
  cacheCurrentUser(user: User, customTTL?: number): void {
    const key = CACHE_KEYS.USER_CURRENT;
    const ttl = customTTL || CACHE_TTL.USER_CURRENT;

    cacheService.set(key, user, ttl, {
      type: "current_user",
      userId: user.id,
      username: user.username,
    });

    errorLogger.info("Current user cached", {
      userId: user.id,
      username: user.username,
      ttl,
      key,
    });
  }

  // Get cached current user
  getCachedCurrentUser(): User | null {
    const key = CACHE_KEYS.USER_CURRENT;
    const user = cacheService.get<User>(key);

    if (user) {
      errorLogger.debug("Current user retrieved from cache", {
        userId: user.id,
        username: user.username,
        key,
      });
    }

    return user;
  }

  // Cache invalidation methods

  // Invalidate specific meeting cache
  invalidateMeeting(meetingId: string): void {
    const keys = [
      CACHE_KEYS.MEETING_DETAIL(meetingId),
      CACHE_KEYS.MEETING_PARTICIPANTS(meetingId),
      CACHE_KEYS.MEETING_PUBLIC(meetingId),
    ];

    keys.forEach((key) => cacheService.delete(key));

    // Invalidate all meeting lists since they might contain this meeting
    cacheService.invalidateByPattern(INVALIDATION_PATTERNS.MEETING_LIST);

    errorLogger.info("Meeting cache invalidated", {
      meetingId,
      invalidatedKeys: keys,
    });
  }

  // Invalidate all meeting-related cache
  invalidateAllMeetings(): void {
    const invalidatedCount = cacheService.invalidateByPattern(
      INVALIDATION_PATTERNS.ALL_MEETINGS
    );

    errorLogger.info("All meeting cache invalidated", {
      invalidatedCount,
    });
  }

  // Invalidate user profile cache
  invalidateUserProfile(userId: string): void {
    const key = CACHE_KEYS.USER_PROFILE(userId);
    cacheService.delete(key);

    // Also invalidate current user if it's the same user
    const currentUser = cacheService.get<User>(CACHE_KEYS.USER_CURRENT);
    if (currentUser && currentUser.id === userId) {
      cacheService.delete(CACHE_KEYS.USER_CURRENT);
    }

    errorLogger.info("User profile cache invalidated", {
      userId,
      invalidatedKeys: [key],
    });
  }

  // Invalidate all user-related cache
  invalidateAllUsers(): void {
    const invalidatedCount = cacheService.invalidateByPattern(
      INVALIDATION_PATTERNS.ALL_USERS
    );

    errorLogger.info("All user cache invalidated", {
      invalidatedCount,
    });
  }

  // Invalidate public user cache
  invalidatePublicUser(sessionId: string): void {
    const key = CACHE_KEYS.PUBLIC_USER(sessionId);
    cacheService.delete(key);

    errorLogger.info("Public user cache invalidated", {
      sessionId,
      invalidatedKeys: [key],
    });
  }

  // Cache utility methods

  // Update TTL for cached data
  updateMeetingTTL(meetingId: string, newTTL: number): void {
    const keys = [
      CACHE_KEYS.MEETING_DETAIL(meetingId),
      CACHE_KEYS.MEETING_PARTICIPANTS(meetingId),
      CACHE_KEYS.MEETING_PUBLIC(meetingId),
    ];

    keys.forEach((key) => {
      if (cacheService.has(key)) {
        cacheService.updateTTL(key, newTTL);
      }
    });

    errorLogger.info("Meeting cache TTL updated", {
      meetingId,
      newTTL,
      updatedKeys: keys.filter((key) => cacheService.has(key)),
    });
  }

  // Check if meeting data is cached
  isMeetingCached(meetingId: string): boolean {
    const key = CACHE_KEYS.MEETING_DETAIL(meetingId);
    return cacheService.has(key);
  }

  // Check if user profile is cached
  isUserCached(userId: string): boolean {
    const key = CACHE_KEYS.USER_PROFILE(userId);
    return cacheService.has(key);
  }

  // Get cache statistics for specific data types
  getMeetingCacheStats(): {
    totalEntries: number;
    details: number;
    lists: number;
    participants: number;
    public: number;
  } {
    const allKeys = cacheService.getKeys();

    const stats = {
      totalEntries: 0,
      details: 0,
      lists: 0,
      participants: 0,
      public: 0,
    };

    allKeys.forEach((key) => {
      if (key.startsWith("meeting:detail:")) stats.details++;
      else if (key.startsWith("meeting:list:")) stats.lists++;
      else if (key.startsWith("meeting:participants:")) stats.participants++;
      else if (key.startsWith("meeting:public:")) stats.public++;
    });

    stats.totalEntries =
      stats.details + stats.lists + stats.participants + stats.public;

    return stats;
  }

  // GetUserCacheStats
  getUserCacheStats(): {
    totalEntries: number;
    profiles: number;
    current: number;
  } {
    const allKeys = cacheService.getKeys();

    const stats = {
      totalEntries: 0,
      profiles: 0,
      current: 0,
    };

    allKeys.forEach((key) => {
      if (key.startsWith("user:profile:")) stats.profiles++;
      else if (key === "user:current") stats.current++;
    });

    stats.totalEntries = stats.profiles + stats.current;

    return stats;
  }

  // Clear all cache (for development/testing)
  clearAllCache(): void {
    cacheService.clear();
    errorLogger.info("All cache cleared");
  }

  // Get comprehensive cache statistics
  getComprehensiveStats(): {
    general: any;
    meetings: ReturnType<CacheManager["getMeetingCacheStats"]>;
    users: ReturnType<CacheManager["getUserCacheStats"]>;
  } {
    return {
      general: cacheService.getStats(),
      meetings: this.getMeetingCacheStats(),
      users: this.getUserCacheStats(),
    };
  }

  // Setup cache event listeners for logging and monitoring
  setupEventListeners(): void {
    // Listen to cache events for monitoring
    cacheService.addEventListener("hit", (event: CacheEvent) => {
      if (event.key.startsWith("meeting:") || event.key.startsWith("user:")) {
        errorLogger.debug("Cache hit for application data", {
          key: event.key,
          type: event.key.split(":")[0],
        });
      }
    });

    cacheService.addEventListener("miss", (event: CacheEvent) => {
      if (event.key.startsWith("meeting:") || event.key.startsWith("user:")) {
        errorLogger.debug("Cache miss for application data", {
          key: event.key,
          type: event.key.split(":")[0],
          reason: event.reason,
        });
      }
    });

    cacheService.addEventListener("evict", (event: CacheEvent) => {
      if (event.key.startsWith("meeting:") || event.key.startsWith("user:")) {
        errorLogger.info("Cache eviction for application data", {
          key: event.key,
          type: event.key.split(":")[0],
          reason: event.reason,
        });
      }
    });
  }
}

// Create singleton instance
export const cacheManager = new CacheManager();

// Initialize event listeners
cacheManager.setupEventListeners();

// Export utilities
export { cacheService };
export type { CacheEvent, CacheEventType };
