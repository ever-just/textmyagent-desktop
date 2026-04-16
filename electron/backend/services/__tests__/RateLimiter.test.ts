import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../../logger', () => ({
  log: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

vi.mock('../../database', () => ({
  getSettingInt: vi.fn((_key: string, defaultValue: number) => defaultValue),
  getSettingBool: vi.fn((_key: string, defaultValue: boolean) => defaultValue),
  getSetting: vi.fn(() => null),
}));

import { RateLimiter } from '../RateLimiter';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  describe('checkLimit', () => {
    it('allows first request from a user', () => {
      const result = limiter.checkLimit('+15551234567');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows multiple requests within the per-user limit', () => {
      for (let i = 0; i < 9; i++) {
        const result = limiter.checkLimit('+15551234567');
        expect(result.allowed).toBe(true);
      }
    });

    it('blocks when per-user limit (default 10) is exceeded', () => {
      // Use up all 10 allowed requests
      for (let i = 0; i < 10; i++) {
        limiter.checkLimit('+15551234567');
      }
      // 11th should be blocked
      const result = limiter.checkLimit('+15551234567');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Rate limit exceeded');
      expect(result.retryAfterMs).toBeDefined();
    });

    it('does not affect other users when one user is rate-limited', () => {
      // Exhaust user A
      for (let i = 0; i < 10; i++) {
        limiter.checkLimit('userA');
      }
      // User B should still be allowed
      const result = limiter.checkLimit('userB');
      expect(result.allowed).toBe(true);
    });

    it('blocks when global limit (default 5000) is exceeded', () => {
      // Use 5000 different users to exhaust the global limit.
      // Default raised from 200 → 5000 in docs/SCALE_AND_EFFICIENCY.md §7 Bottleneck #1.
      for (let i = 0; i < 5000; i++) {
        limiter.checkLimit(`user-${i}`);
      }
      // 5001st request should be globally rate-limited
      const result = limiter.checkLimit('user-overflow');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Global rate limit exceeded');
    });
  });

  describe('getUserState', () => {
    it('returns zero requests for unknown user', () => {
      const state = limiter.getUserState('unknown');
      expect(state.requestsInWindow).toBe(0);
      expect(state.limit).toBe(10);
    });

    it('returns correct count after requests', () => {
      limiter.checkLimit('testUser');
      limiter.checkLimit('testUser');
      limiter.checkLimit('testUser');
      const state = limiter.getUserState('testUser');
      expect(state.requestsInWindow).toBe(3);
    });
  });

  describe('getGlobalState', () => {
    it('returns zero requests initially', () => {
      const state = limiter.getGlobalState();
      expect(state.requestsInWindow).toBe(0);
      // Default raised from 200 → 5000 (see RateLimiter.ts comment + SCALE_AND_EFFICIENCY.md).
      expect(state.limit).toBe(5000);
    });

    it('increments after requests', () => {
      limiter.checkLimit('a');
      limiter.checkLimit('b');
      const state = limiter.getGlobalState();
      expect(state.requestsInWindow).toBe(2);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      for (let i = 0; i < 10; i++) {
        limiter.checkLimit('user');
      }
      expect(limiter.checkLimit('user').allowed).toBe(false);

      limiter.reset();

      expect(limiter.checkLimit('user').allowed).toBe(true);
      expect(limiter.getGlobalState().requestsInWindow).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('does not throw on empty state', () => {
      expect(() => limiter.cleanup()).not.toThrow();
    });

    it('preserves recent entries', () => {
      limiter.checkLimit('user');
      limiter.cleanup();
      const state = limiter.getUserState('user');
      expect(state.requestsInWindow).toBe(1);
    });
  });
});
