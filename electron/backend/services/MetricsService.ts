import { log } from '../logger';
import os from 'os';

/**
 * MetricsService — lightweight in-memory metrics collection for observability.
 * Phase 5.4 of docs/SCALE_AND_EFFICIENCY.md.
 *
 * Designed to be cheap: tiny ring buffers, no external dependencies, no persistence.
 * Data resets on process restart — fine because this is for operational visibility,
 * not billing/compliance.
 *
 * Consumers (dashboard, debug logs) query via the singleton `metricsService`.
 */

interface LatencySample {
  durationMs: number;
  at: number;            // epoch ms
  scenario: 'warm' | 'cold' | 'summary' | 'unknown';
  toolsUsed: number;     // count of tools invoked during the message
}

interface MessageEvent {
  at: number;
  chatGuid: string;
  outcome: 'sent' | 'rate_limited' | 'queue_dropped' | 'error' | 'tool_only' | 'wait';
}

export interface MetricsSnapshot {
  // Timestamp of the snapshot
  capturedAt: string;

  // Per-message latency (rolling window)
  latency: {
    sampleCount: number;
    windowSeconds: number;
    avgMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
    byScenario: {
      warm: { count: number; avgMs: number | null };
      cold: { count: number; avgMs: number | null };
      summary: { count: number; avgMs: number | null };
    };
  };

  // Throughput (messages per hour, extrapolated from last N minutes)
  throughput: {
    last5MinCount: number;
    last15MinCount: number;
    last60MinCount: number;
    messagesPerHourEstimate: number;
  };

  // Outcome breakdown
  outcomes: {
    sent: number;
    rate_limited: number;
    queue_dropped: number;
    error: number;
    tool_only: number;
    wait: number;
  };

  // System resource estimate
  system: {
    totalRamGB: number;
    freeRamGB: number;
    ramUsedPct: number;
    processRssMB: number;
  };

  // Uptime info
  process: {
    uptimeSeconds: number;
  };
}

// Ring buffer size — holds enough samples for stable percentiles without growing unbounded.
// 500 samples @ worst-case 15s each ≈ 2hr of history.
const LATENCY_RING_SIZE = 500;
const EVENTS_RING_SIZE = 500;

export class MetricsService {
  private latencyRing: LatencySample[] = [];
  private latencyIdx = 0;

  private eventsRing: MessageEvent[] = [];
  private eventsIdx = 0;

  private startedAt = Date.now();

  /**
   * Record a completed LLM inference with its latency.
   * Called from AgentService after each LLM response attempt.
   */
  recordLatency(durationMs: number, scenario: LatencySample['scenario'], toolsUsed: number = 0): void {
    const sample: LatencySample = { durationMs, at: Date.now(), scenario, toolsUsed };
    if (this.latencyRing.length < LATENCY_RING_SIZE) {
      this.latencyRing.push(sample);
    } else {
      this.latencyRing[this.latencyIdx] = sample;
      this.latencyIdx = (this.latencyIdx + 1) % LATENCY_RING_SIZE;
    }
  }

  /**
   * Record a message outcome (sent, rate-limited, dropped, errored, etc).
   */
  recordEvent(chatGuid: string, outcome: MessageEvent['outcome']): void {
    const event: MessageEvent = { at: Date.now(), chatGuid, outcome };
    if (this.eventsRing.length < EVENTS_RING_SIZE) {
      this.eventsRing.push(event);
    } else {
      this.eventsRing[this.eventsIdx] = event;
      this.eventsIdx = (this.eventsIdx + 1) % EVENTS_RING_SIZE;
    }
  }

  /**
   * Build a metrics snapshot for the dashboard / /api/metrics endpoint.
   * Cheap to call — aggregation is O(ring_size), no DB I/O.
   */
  getSnapshot(): MetricsSnapshot {
    const now = Date.now();
    const samples = [...this.latencyRing];
    const events = [...this.eventsRing];

    // ----- Latency aggregation -----
    const sorted = samples.map(s => s.durationMs).sort((a, b) => a - b);
    const avg = sorted.length > 0 ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null;
    const p50 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : null;
    const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : null;
    const max = sorted.length > 0 ? sorted[sorted.length - 1] : null;

    const byScenario = {
      warm: this.avgByScenario(samples, 'warm'),
      cold: this.avgByScenario(samples, 'cold'),
      summary: this.avgByScenario(samples, 'summary'),
    };

    const windowSeconds = samples.length > 0
      ? Math.max(1, Math.round((now - samples[0].at) / 1000))
      : 0;

    // ----- Throughput aggregation -----
    const last5MinCount = events.filter(e => now - e.at < 5 * 60_000 && e.outcome === 'sent').length;
    const last15MinCount = events.filter(e => now - e.at < 15 * 60_000 && e.outcome === 'sent').length;
    const last60MinCount = events.filter(e => now - e.at < 60 * 60_000 && e.outcome === 'sent').length;

    // Use the most recent full 15-min window for the rate estimate; fall back to smaller windows
    // if we don't have 15 min of history yet.
    let rateBase = last15MinCount;
    let rateWindowMin = 15;
    if (rateBase === 0 && last5MinCount > 0) {
      rateBase = last5MinCount;
      rateWindowMin = 5;
    }
    const messagesPerHourEstimate = rateBase > 0
      ? Math.round((rateBase / rateWindowMin) * 60)
      : 0;

    // ----- Outcome breakdown -----
    const outcomes = {
      sent: 0,
      rate_limited: 0,
      queue_dropped: 0,
      error: 0,
      tool_only: 0,
      wait: 0,
    };
    for (const ev of events) {
      outcomes[ev.outcome] = (outcomes[ev.outcome] || 0) + 1;
    }

    // ----- System resource info -----
    const totalRam = os.totalmem();
    const freeRam = os.freemem();
    const mem = process.memoryUsage();
    const totalRamGB = Math.round(totalRam / (1024 ** 3) * 10) / 10;
    const freeRamGB = Math.round(freeRam / (1024 ** 3) * 10) / 10;
    const ramUsedPct = Math.round((1 - freeRam / totalRam) * 100);
    const processRssMB = Math.round(mem.rss / (1024 * 1024));

    return {
      capturedAt: new Date().toISOString(),
      latency: {
        sampleCount: samples.length,
        windowSeconds,
        avgMs: avg,
        p50Ms: p50,
        p95Ms: p95,
        maxMs: max,
        byScenario,
      },
      throughput: {
        last5MinCount,
        last15MinCount,
        last60MinCount,
        messagesPerHourEstimate,
      },
      outcomes,
      system: {
        totalRamGB,
        freeRamGB,
        ramUsedPct,
        processRssMB,
      },
      process: {
        uptimeSeconds: Math.round((now - this.startedAt) / 1000),
      },
    };
  }

  private avgByScenario(samples: LatencySample[], scenario: LatencySample['scenario']): { count: number; avgMs: number | null } {
    const filtered = samples.filter(s => s.scenario === scenario);
    if (filtered.length === 0) return { count: 0, avgMs: null };
    const avg = Math.round(filtered.reduce((a, b) => a + b.durationMs, 0) / filtered.length);
    return { count: filtered.length, avgMs: avg };
  }

  /**
   * Reset all in-memory counters. Useful for tests.
   */
  reset(): void {
    this.latencyRing = [];
    this.latencyIdx = 0;
    this.eventsRing = [];
    this.eventsIdx = 0;
    this.startedAt = Date.now();
    log('debug', 'MetricsService reset');
  }
}

export const metricsService = new MetricsService();
