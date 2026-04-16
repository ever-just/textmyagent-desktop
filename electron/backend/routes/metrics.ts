import { Router, Request, Response } from 'express';
import { metricsService } from '../services/MetricsService';
import { localLLMService } from '../services/LocalLLMService';
import { rateLimiter } from '../services/RateLimiter';
import { agentService } from '../services/AgentService';
import { log } from '../logger';

const router = Router();

/**
 * GET /api/dashboard/metrics
 *
 * Returns a unified metrics snapshot including:
 * - Per-message latency (avg, p50, p95, max) + scenario breakdown
 * - Throughput estimate (messages/hour)
 * - Outcome breakdown (sent/rate_limited/dropped/error/tool_only/wait)
 * - System resources (RAM, process RSS)
 * - LLM pool state (size, max, session ages)
 * - Rate limiter state (global window usage)
 * - Queue state (per-chat queue depths + aggregate)
 *
 * Safe to call frequently — no DB I/O, all in-memory aggregation.
 * Phase 5.4 of docs/SCALE_AND_EFFICIENCY.md.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const snapshot = metricsService.getSnapshot();
    const poolStats = localLLMService.getPoolStats();
    const rateLimitGlobal = rateLimiter.getGlobalState();
    const queueStats = agentService.getQueueStats();

    res.json({
      ...snapshot,
      pool: {
        size: poolStats.size,
        maxSize: poolStats.maxSize,
        utilizationPct: poolStats.maxSize > 0
          ? Math.round((poolStats.size / poolStats.maxSize) * 100)
          : 0,
        sessions: poolStats.entries.map(e => ({
          chatGuid: e.chatGuid,
          ageMs: e.ageMs,
          ageHuman: formatDuration(e.ageMs),
        })),
      },
      rateLimit: {
        global: {
          requestsInWindow: rateLimitGlobal.requestsInWindow,
          limit: rateLimitGlobal.limit,
          windowMs: rateLimitGlobal.windowMs,
          utilizationPct: rateLimitGlobal.limit > 0
            ? Math.round((rateLimitGlobal.requestsInWindow / rateLimitGlobal.limit) * 100)
            : 0,
        },
      },
      queues: queueStats,
    });
  } catch (error) {
    log('error', 'Get metrics failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export default router;
