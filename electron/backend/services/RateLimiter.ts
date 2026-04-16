import { log } from '../logger';
import { getSettingInt } from '../database';

// Sliding-window per-user rate limiter + fixed-window global rate limiter
// Phase 1, Task 1.2

interface SlidingWindowEntry {
  timestamps: number[]; // request timestamps within the window
}

interface GlobalWindow {
  windowStart: number;
  requestCount: number;
}

export interface RateLimitCheck {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

export class RateLimiter {
  private perUserWindows: Map<string, SlidingWindowEntry> = new Map();
  private globalWindow: GlobalWindow = { windowStart: Date.now(), requestCount: 0 };

  // Defaults — overridden by settings at check time
  private static DEFAULT_PER_USER_LIMIT = 10;     // per minute
  private static DEFAULT_PER_USER_WINDOW_MS = 60_000; // 1 minute
  // DEFAULT_GLOBAL_LIMIT raised from 200 → 5000 after scale analysis
  // (docs/SCALE_AND_EFFICIENCY.md §7 Bottleneck #1). Original 200/hr was
  // sized for paid-API cost control; local inference has no per-message cost,
  // so this was capping throughput to ~17% of real hardware capacity.
  private static DEFAULT_GLOBAL_LIMIT = 5000;      // per hour
  private static DEFAULT_GLOBAL_WINDOW_MS = 3_600_000; // 1 hour

  /**
   * Check if a request from the given user is allowed.
   * Reads current limits from settings DB on each call (cheap — SQLite is fast).
   */
  checkLimit(userHandle: string): RateLimitCheck {
    const now = Date.now();

    // --- Per-user sliding window ---
    const perUserLimit = getSettingInt('security.rateLimitPerMinute', RateLimiter.DEFAULT_PER_USER_LIMIT);
    const windowMs = RateLimiter.DEFAULT_PER_USER_WINDOW_MS;

    let entry = this.perUserWindows.get(userHandle);
    if (!entry) {
      entry = { timestamps: [] };
      this.perUserWindows.set(userHandle, entry);
    }

    // Evict timestamps outside the sliding window
    const windowStart = now - windowMs;
    entry.timestamps = entry.timestamps.filter(t => t > windowStart);

    if (entry.timestamps.length >= perUserLimit) {
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = oldestInWindow + windowMs - now;
      log('warn', 'Per-user rate limit exceeded', { userHandle, count: entry.timestamps.length, limit: perUserLimit });
      return {
        allowed: false,
        reason: `Rate limit exceeded: max ${perUserLimit} messages per minute`,
        retryAfterMs: Math.max(retryAfterMs, 0),
      };
    }

    // --- Global fixed window ---
    const globalLimit = getSettingInt('security.rateLimitGlobalPerHour', RateLimiter.DEFAULT_GLOBAL_LIMIT);
    const globalWindowMs = RateLimiter.DEFAULT_GLOBAL_WINDOW_MS;

    if (now - this.globalWindow.windowStart >= globalWindowMs) {
      // Reset window
      this.globalWindow = { windowStart: now, requestCount: 0 };
    }

    if (this.globalWindow.requestCount >= globalLimit) {
      const retryAfterMs = this.globalWindow.windowStart + globalWindowMs - now;
      log('warn', 'Global rate limit exceeded', { count: this.globalWindow.requestCount, limit: globalLimit });
      return {
        allowed: false,
        reason: `Global rate limit exceeded: max ${globalLimit} messages per hour`,
        retryAfterMs: Math.max(retryAfterMs, 0),
      };
    }

    // Both checks passed — record the request
    entry.timestamps.push(now);
    this.globalWindow.requestCount++;

    return { allowed: true };
  }

  /**
   * Get current rate limit state for a user (for dashboard display).
   */
  getUserState(userHandle: string): { requestsInWindow: number; limit: number; windowMs: number } {
    const now = Date.now();
    const windowMs = RateLimiter.DEFAULT_PER_USER_WINDOW_MS;
    const limit = getSettingInt('security.rateLimitPerMinute', RateLimiter.DEFAULT_PER_USER_LIMIT);
    const entry = this.perUserWindows.get(userHandle);

    if (!entry) {
      return { requestsInWindow: 0, limit, windowMs };
    }

    const windowStart = now - windowMs;
    const active = entry.timestamps.filter(t => t > windowStart);
    return { requestsInWindow: active.length, limit, windowMs };
  }

  /**
   * Get global rate limit state (for dashboard display).
   */
  getGlobalState(): { requestsInWindow: number; limit: number; windowMs: number; windowStart: number } {
    const limit = getSettingInt('security.rateLimitGlobalPerHour', RateLimiter.DEFAULT_GLOBAL_LIMIT);
    return {
      requestsInWindow: this.globalWindow.requestCount,
      limit,
      windowMs: RateLimiter.DEFAULT_GLOBAL_WINDOW_MS,
      windowStart: this.globalWindow.windowStart,
    };
  }

  /**
   * Clean up stale per-user entries to prevent memory leak.
   * Call periodically (e.g. every 5 minutes).
   */
  cleanup(): void {
    const now = Date.now();
    const windowMs = RateLimiter.DEFAULT_PER_USER_WINDOW_MS;
    const windowStart = now - windowMs;

    for (const [handle, entry] of this.perUserWindows) {
      entry.timestamps = entry.timestamps.filter(t => t > windowStart);
      if (entry.timestamps.length === 0) {
        this.perUserWindows.delete(handle);
      }
    }
  }

  /**
   * Reset all rate limit state (for testing or admin action).
   */
  reset(): void {
    this.perUserWindows.clear();
    this.globalWindow = { windowStart: Date.now(), requestCount: 0 };
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();
