import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import os from 'os';

// ===========================================================================
// Regression tests for scale & efficiency improvements.
// Covers:
//   Phase 2.1  — Adaptive pool size + model recommendation by RAM
//   Phase 2.3  — Idle TTL on pool
//   Phase 4.1  — Queue drop-newest policy (structural assertion on code)
//   Phase 4.2  — onSessionEvicted callback pattern
//   Phase 5.4  — MetricsService ring buffers + snapshot
//   Phase 1    — RateLimiter default raised (verified in RateLimiter.test.ts)
//   Phase 1    — polling.sleepIntervalMs code/DB unified (structural)
//
// These are pure-logic tests — no real llama.cpp inference, no Electron runtime.
// ===========================================================================

// ---------------------------------------------------------------------------
// Mocks — we avoid loading the real node-llama-cpp by mocking the module import
// (LocalLLMService calls it lazily via dynamic import, so most paths won't touch it)
// ---------------------------------------------------------------------------
vi.mock('../../database', () => {
  const settings: Record<string, string> = {};
  return {
    getDatabase: vi.fn().mockReturnValue({
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn(),
      }),
    }),
    getSetting: vi.fn((key: string) => settings[key]),
    getSettingInt: vi.fn((key: string, fallback: number) => {
      const v = settings[key];
      return v !== undefined ? parseInt(JSON.parse(v), 10) : fallback;
    }),
    getSettingFloat: vi.fn((key: string, fallback: number) => {
      const v = settings[key];
      return v !== undefined ? parseFloat(JSON.parse(v)) : fallback;
    }),
    getSettingBool: vi.fn((key: string, fallback: boolean) => {
      const v = settings[key];
      return v !== undefined ? JSON.parse(v) : fallback;
    }),
    recordApiUsage: vi.fn(),
  };
});

vi.mock('../../logger', () => ({
  log: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

// ===========================================================================
// Section 1: MetricsService (pure, no dependencies)
// ===========================================================================
describe('MetricsService (Phase 5.4)', () => {
  // Import dynamically so the mocks above are picked up
  let metricsService: any;

  beforeEach(async () => {
    const mod = await import('../MetricsService');
    metricsService = mod.metricsService;
    metricsService.reset();
  });

  it('records latency samples and aggregates them into a snapshot', () => {
    metricsService.recordLatency(5000, 'warm', 0);
    metricsService.recordLatency(10000, 'cold', 1);
    metricsService.recordLatency(7500, 'warm', 0);

    const snap = metricsService.getSnapshot();
    expect(snap.latency.sampleCount).toBe(3);
    expect(snap.latency.avgMs).toBe(Math.round((5000 + 10000 + 7500) / 3));
    expect(snap.latency.maxMs).toBe(10000);
    expect(snap.latency.byScenario.warm.count).toBe(2);
    expect(snap.latency.byScenario.cold.count).toBe(1);
  });

  it('records outcomes and exposes them in snapshot', () => {
    metricsService.recordEvent('chat-1', 'sent');
    metricsService.recordEvent('chat-1', 'sent');
    metricsService.recordEvent('chat-2', 'rate_limited');
    metricsService.recordEvent('chat-3', 'queue_dropped');
    metricsService.recordEvent('chat-4', 'error');

    const snap = metricsService.getSnapshot();
    expect(snap.outcomes.sent).toBe(2);
    expect(snap.outcomes.rate_limited).toBe(1);
    expect(snap.outcomes.queue_dropped).toBe(1);
    expect(snap.outcomes.error).toBe(1);
  });

  it('computes percentiles over the ring buffer', () => {
    // 100 samples, evenly distributed 100ms..10000ms
    for (let i = 1; i <= 100; i++) {
      metricsService.recordLatency(i * 100, 'warm', 0);
    }
    const snap = metricsService.getSnapshot();
    expect(snap.latency.sampleCount).toBe(100);
    // p50 ≈ 50th sample = 5000ms
    expect(snap.latency.p50Ms).toBeGreaterThanOrEqual(4900);
    expect(snap.latency.p50Ms).toBeLessThanOrEqual(5100);
    // p95 ≈ 95th sample = 9500ms
    expect(snap.latency.p95Ms).toBeGreaterThanOrEqual(9400);
    expect(snap.latency.p95Ms).toBeLessThanOrEqual(9600);
  });

  it('ring buffer wraps at 500 entries without growing unbounded', () => {
    for (let i = 0; i < 700; i++) {
      metricsService.recordLatency(i, 'warm', 0);
    }
    const snap = metricsService.getSnapshot();
    // Ring buffer max is 500; we recorded 700 → should still be 500
    expect(snap.latency.sampleCount).toBe(500);
  });

  it('estimates messages-per-hour from sent events', () => {
    // Record 15 sent events "now"
    for (let i = 0; i < 15; i++) {
      metricsService.recordEvent(`chat-${i}`, 'sent');
    }
    const snap = metricsService.getSnapshot();
    // 15 msgs in 15 min window → ~60 msg/hr
    expect(snap.throughput.last15MinCount).toBe(15);
    expect(snap.throughput.messagesPerHourEstimate).toBe(60);
  });

  it('includes system resource snapshot', () => {
    const snap = metricsService.getSnapshot();
    expect(snap.system.totalRamGB).toBeGreaterThan(0);
    expect(snap.system.processRssMB).toBeGreaterThan(0);
    expect(snap.system.ramUsedPct).toBeGreaterThanOrEqual(0);
    expect(snap.system.ramUsedPct).toBeLessThanOrEqual(100);
  });

  it('returns null latency percentiles when no samples yet', () => {
    const snap = metricsService.getSnapshot();
    expect(snap.latency.sampleCount).toBe(0);
    expect(snap.latency.avgMs).toBeNull();
    expect(snap.latency.p50Ms).toBeNull();
    expect(snap.latency.p95Ms).toBeNull();
  });
});

// ===========================================================================
// Section 2: LocalLLMService pool sizing + eviction handlers (unit-testable)
// ===========================================================================
describe('LocalLLMService pool & eviction (Phase 2)', () => {
  let LocalLLMService: any;
  let service: any;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../LocalLLMService');
    LocalLLMService = mod.LocalLLMService;
    service = new LocalLLMService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('detectRecommendedPoolSize (Phase 2.1)', () => {
    it('recommends E2B + pool=2 on 8GB Mac', () => {
      vi.spyOn(os, 'totalmem').mockReturnValue(8 * 1024 ** 3);
      const rec = service.detectRecommendedPoolSize();
      expect(rec.recommendedModel).toBe('E2B');
      expect(rec.maxPooledSessions).toBe(2);
      expect(rec.totalRamGB).toBe(8);
    });

    it('recommends E4B + pool=4 on 16GB Mac', () => {
      vi.spyOn(os, 'totalmem').mockReturnValue(16 * 1024 ** 3);
      const rec = service.detectRecommendedPoolSize();
      expect(rec.recommendedModel).toBe('E4B');
      expect(rec.maxPooledSessions).toBe(4);
      expect(rec.totalRamGB).toBe(16);
    });

    it('recommends E4B + pool=6 on 32GB Mac', () => {
      vi.spyOn(os, 'totalmem').mockReturnValue(32 * 1024 ** 3);
      const rec = service.detectRecommendedPoolSize();
      expect(rec.recommendedModel).toBe('E4B');
      expect(rec.maxPooledSessions).toBe(6);
      expect(rec.totalRamGB).toBe(32);
    });

    it('recommends E4B + pool=10 on 64GB+ Mac', () => {
      vi.spyOn(os, 'totalmem').mockReturnValue(64 * 1024 ** 3);
      const rec = service.detectRecommendedPoolSize();
      expect(rec.recommendedModel).toBe('E4B');
      expect(rec.maxPooledSessions).toBe(10);
      expect(rec.totalRamGB).toBe(64);
    });

    it('includes a human-readable notes string', () => {
      vi.spyOn(os, 'totalmem').mockReturnValue(16 * 1024 ** 3);
      const rec = service.detectRecommendedPoolSize();
      expect(typeof rec.notes).toBe('string');
      expect(rec.notes.length).toBeGreaterThan(0);
    });
  });

  describe('contextSize default (Phase 2.2)', () => {
    it('defaults to 4096 (was 8192)', () => {
      // Read private field via cast — testing the documented default
      expect((service as any).contextSize).toBe(4096);
    });
  });

  describe('onSessionEvicted callback (Phase 4.2)', () => {
    it('registers handlers via onSessionEvicted', () => {
      const handler = vi.fn();
      service.onSessionEvicted(handler);
      expect((service as any).onSessionEvictedHandlers.length).toBe(1);
    });

    it('supports multiple handlers', () => {
      service.onSessionEvicted(vi.fn());
      service.onSessionEvicted(vi.fn());
      expect((service as any).onSessionEvictedHandlers.length).toBe(2);
    });

    it('fires all handlers with chatGuid + reason when eviction happens', async () => {
      const handler = vi.fn();
      service.onSessionEvicted(handler);

      // Directly invoke the private fireEvictionHandlers
      await (service as any).fireEvictionHandlers('chat-abc', 'lru');

      expect(handler).toHaveBeenCalledWith('chat-abc', 'lru');
    });

    it('swallows synchronous handler errors (does not propagate)', async () => {
      const goodHandler = vi.fn();
      const badHandler = vi.fn(() => {
        throw new Error('boom');
      });
      service.onSessionEvicted(badHandler);
      service.onSessionEvicted(goodHandler);

      await expect(
        (service as any).fireEvictionHandlers('chat-xyz', 'manual')
      ).resolves.not.toThrow();
      // Good handler still fires after bad one throws
      expect(goodHandler).toHaveBeenCalled();
    });

    it('async handler rejections do not break eviction', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('async fail'));
      service.onSessionEvicted(handler);

      await expect(
        (service as any).fireEvictionHandlers('chat-async', 'idle_ttl')
      ).resolves.not.toThrow();
    });
  });

  describe('sweepIdleSessions (Phase 2.3)', () => {
    it('evicts sessions older than IDLE_TTL_MS', async () => {
      const handler = vi.fn();
      service.onSessionEvicted(handler);

      // Inject 2 fake pool entries — one idle, one fresh
      const now = Date.now();
      const idleMs = LocalLLMService.IDLE_TTL_MS || 10 * 60 * 1000;
      const fakeDispose = vi.fn();

      (service as any).sessionPool.set('stale-chat', {
        session: { dispose: fakeDispose },
        lastActivity: now - idleMs - 1000, // idle > TTL
        chatGuid: 'stale-chat',
        systemPrompt: 'test',
      });
      (service as any).sessionPool.set('fresh-chat', {
        session: { dispose: fakeDispose },
        lastActivity: now, // fresh
        chatGuid: 'fresh-chat',
        systemPrompt: 'test',
      });

      const evicted = await service.sweepIdleSessions();
      expect(evicted).toEqual(['stale-chat']);
      expect(handler).toHaveBeenCalledWith('stale-chat', 'idle_ttl');
      expect((service as any).sessionPool.has('stale-chat')).toBe(false);
      expect((service as any).sessionPool.has('fresh-chat')).toBe(true);
    });

    it('returns empty array when no sessions are idle', async () => {
      (service as any).sessionPool.set('active-chat', {
        session: { dispose: vi.fn() },
        lastActivity: Date.now(),
        chatGuid: 'active-chat',
        systemPrompt: 'test',
      });

      const evicted = await service.sweepIdleSessions();
      expect(evicted).toEqual([]);
    });
  });

  describe('parseFactsJson (Phase 2C)', () => {
    it('parses a plain JSON array of strings', () => {
      const out = (service as any).parseFactsJson('["name is Alex","lives in NYC"]');
      expect(out).toEqual(['name is Alex', 'lives in NYC']);
    });

    it('strips markdown code fences', () => {
      const raw = '```json\n["likes coffee", "works at Google"]\n```';
      const out = (service as any).parseFactsJson(raw);
      expect(out).toEqual(['likes coffee', 'works at Google']);
    });

    it('extracts the first JSON array when surrounded by prose', () => {
      const raw = 'Sure, here are the facts: ["name is Sam"] — hope that helps.';
      const out = (service as any).parseFactsJson(raw);
      expect(out).toEqual(['name is Sam']);
    });

    it('returns [] when no JSON array is present', () => {
      const out = (service as any).parseFactsJson('No facts found.');
      expect(out).toEqual([]);
    });

    it('returns [] on malformed JSON', () => {
      const out = (service as any).parseFactsJson('["unclosed');
      expect(out).toEqual([]);
    });

    it('filters non-string entries and deduplicates case-insensitively', () => {
      const raw = '["Likes coffee", "likes coffee", 42, null, "works at ACME"]';
      const out = (service as any).parseFactsJson(raw);
      expect(out).toEqual(['Likes coffee', 'works at ACME']);
    });

    it('drops entries shorter than 3 chars and caps length at 200', () => {
      const long = 'x'.repeat(300);
      const raw = JSON.stringify(['ok', 'hi!', long]);
      const out = (service as any).parseFactsJson(raw);
      expect(out).toHaveLength(2);
      expect(out[0]).toBe('hi!');
      expect(out[1].length).toBe(200);
    });

    it('caps output at 10 facts', () => {
      const many = Array.from({ length: 20 }, (_, i) => `fact number ${i}`);
      const raw = JSON.stringify(many);
      const out = (service as any).parseFactsJson(raw);
      expect(out).toHaveLength(10);
    });

    it('returns [] when parsed JSON is not an array', () => {
      const out = (service as any).parseFactsJson('{"a": 1}');
      expect(out).toEqual([]);
    });
  });

  describe('getPoolStats (Phase 5.4)', () => {
    it('returns current pool size + max + entry ages', () => {
      const now = Date.now();
      (service as any).sessionPool.set('chat-a', {
        session: { dispose: vi.fn() },
        lastActivity: now - 5000,
        chatGuid: 'chat-a',
        systemPrompt: '',
      });
      (service as any).sessionPool.set('chat-b', {
        session: { dispose: vi.fn() },
        lastActivity: now - 1000,
        chatGuid: 'chat-b',
        systemPrompt: '',
      });
      (service as any).maxPooledSessions = 4;

      const stats = service.getPoolStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(4);
      expect(stats.entries).toHaveLength(2);
      const chatA = stats.entries.find((e: any) => e.chatGuid === 'chat-a');
      expect(chatA?.ageMs).toBeGreaterThanOrEqual(5000);
    });

    it('returns empty entries when pool is empty', () => {
      const stats = service.getPoolStats();
      expect(stats.size).toBe(0);
      expect(stats.entries).toEqual([]);
    });
  });
});

// ===========================================================================
// Section 3: Structural assertions — code invariants documented in plan
// ===========================================================================
describe('Structural invariants (Phase 1-5)', () => {
  it('RateLimiter default global limit is 5000 (Phase 1.1)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../RateLimiter.ts'),
      'utf-8'
    );
    expect(source).toContain('DEFAULT_GLOBAL_LIMIT = 5000');
    expect(source).not.toMatch(/DEFAULT_GLOBAL_LIMIT\s*=\s*200\b/);
  });

  it('database.ts seeds rateLimitGlobalPerHour to 5000 (Phase 1.1)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../database.ts'),
      'utf-8'
    );
    expect(source).toContain("'security.rateLimitGlobalPerHour': JSON.stringify(5000)");
  });

  it('iMessageService sleep interval code default unified to 15000 (Phase 1)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../iMessageService.ts'),
      'utf-8'
    );
    expect(source).toContain("getSettingInt('polling.sleepIntervalMs', 15000)");
  });

  it('LocalLLMService default contextSize is 4096 (Phase 2.2)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../LocalLLMService.ts'),
      'utf-8'
    );
    expect(source).toMatch(/private\s+contextSize\s*=\s*4096/);
  });

  it('LocalLLMService always passes contextSize explicitly (Phase 2.2)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../LocalLLMService.ts'),
      'utf-8'
    );
    // Should have removed the old `if (this.contextSize !== 8192)` guard at least once
    // (there may be other checks but the ctxOpts construction should always include contextSize)
    const initContextBlock = source.match(/sequences: this\.maxPooledSessions,\s*\n\s*contextSize: this\.contextSize/);
    expect(initContextBlock).not.toBeNull();
  });

  it('AgentService drop policy is drop-newest (Phase 4.1)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    expect(source).toContain('dropping NEW incoming message');
    expect(source).not.toContain('dropping oldest queued message');
  });

  it('AgentService registers onSessionEvicted handler on LocalLLMService (Phase 4.2)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    expect(source).toContain('localLLMService.onSessionEvicted(');
    expect(source).toContain('summarizeEvictedSession');
  });

  it('AgentService coalesces queued messages on drain (Phase 3B)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    expect(source).toContain('coalesceQueuedMessages');
    expect(source).toContain('Coalescing queued messages into a single prompt');
  });

  it('AgentService auto-extracts facts on eviction (Phase 2C)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    expect(source).toContain('extractFactsFromTranscript');
    expect(source).toContain("'memory.enableFactExtraction'");
    expect(source).toContain("'auto_extracted'");
  });

  it('AgentService loads conversation summary on cold-start (Phase 5.3)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    expect(source).toContain('getLatestSummary');
    expect(source).toContain('conversationSummary');
  });

  it('AgentService skips full history reload on warm conversations (Phase 3.1)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    expect(source).toContain('WARM_CONTEXT_MS');
    expect(source).toContain('isWarm');
  });

  it('AgentService records metrics events for outcomes (Phase 5.4)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    expect(source).toContain("metricsService.recordEvent(chatGuid, 'sent')");
    expect(source).toContain("metricsService.recordEvent(chatGuid, 'rate_limited')");
    expect(source).toContain("metricsService.recordEvent(chatGuid, 'queue_dropped')");
    expect(source).toContain("metricsService.recordEvent(chatGuid, 'error')");
    expect(source).toContain('metricsService.recordLatency(');
  });

  it('LocalLLMService exposes generateSummary for ephemeral summarization (Phase 4.2)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../LocalLLMService.ts'),
      'utf-8'
    );
    expect(source).toContain('async generateSummary(');
    // Must dispose its ephemeral session
    expect(source).toContain('session?.dispose?.()');
  });

  it('server.ts mounts /api/dashboard/metrics route (Phase 5.4)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../server.ts'),
      'utf-8'
    );
    expect(source).toContain("import metricsRoutes from './routes/metrics'");
    expect(source).toContain("expressApp.use('/api/dashboard/metrics', metricsRoutes)");
  });
});

// ===========================================================================
// Section 4: MetricsService reset behavior (used by tests + ops reset)
// ===========================================================================
describe('MetricsService reset', () => {
  let metricsService: any;

  beforeEach(async () => {
    const mod = await import('../MetricsService');
    metricsService = mod.metricsService;
    metricsService.reset();
  });

  it('clears all samples and events', () => {
    metricsService.recordLatency(1000, 'warm', 0);
    metricsService.recordEvent('c1', 'sent');

    let snap = metricsService.getSnapshot();
    expect(snap.latency.sampleCount).toBe(1);
    expect(snap.outcomes.sent).toBe(1);

    metricsService.reset();

    snap = metricsService.getSnapshot();
    expect(snap.latency.sampleCount).toBe(0);
    expect(snap.outcomes.sent).toBe(0);
  });
});
