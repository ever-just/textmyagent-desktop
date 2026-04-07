import { Router, Request, Response } from 'express';
import { getDatabase, getSetting, setSetting, getSettingInt, getSettingBool } from '../database';
import { log } from '../logger';
import { rateLimiter } from '../services/RateLimiter';

const router = Router();

// --- Security Events ---
router.get('/events', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { severity, limit = '50', offset = '0' } = req.query;

    let query = `
      SELECT id, event_type as eventType, user_handle as userHandle, 
             details, severity, created_at as createdAt
      FROM security_events
    `;
    const params: any[] = [];

    if (severity && severity !== 'all') {
      query += ' WHERE severity = ?';
      params.push(severity);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit as string, 10), parseInt(offset as string, 10));

    const events = db.prepare(query).all(...params).map((row: any) => ({
      ...row,
      details: row.details ? JSON.parse(row.details) : {},
    }));

    const total = db.prepare(
      severity && severity !== 'all'
        ? 'SELECT COUNT(*) as count FROM security_events WHERE severity = ?'
        : 'SELECT COUNT(*) as count FROM security_events'
    ).get(...(severity && severity !== 'all' ? [severity] : [])) as { count: number };

    res.json({ events, total: total.count });
  } catch (error) {
    log('error', 'Get security events failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get security events' });
  }
});

// --- Security Config ---
router.get('/config', async (_req: Request, res: Response) => {
  try {
    res.json({
      rateLimitPerMinute: getSettingInt('security.rateLimitPerMinute', 10),
      rateLimitGlobalPerHour: getSettingInt('security.rateLimitGlobalPerHour', 200),
      dailyBudgetCents: getSettingInt('security.dailyBudgetCents', 0),
      maxApiCallsPerMessage: getSettingInt('security.maxApiCallsPerMessage', 6),
      outputSanitization: getSettingBool('security.outputSanitization', true),
    });
  } catch (error) {
    log('error', 'Get security config failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get security config' });
  }
});

// --- Budget Status ---
router.get('/budget', async (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const today = new Date().toISOString().split('T')[0];
    const dailyBudgetCents = getSettingInt('security.dailyBudgetCents', 0);

    const row = db.prepare(
      'SELECT SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens FROM api_usage WHERE date = ?'
    ).get(today) as { inputTokens: number | null; outputTokens: number | null } | undefined;

    const inputTokens = row?.inputTokens || 0;
    const outputTokens = row?.outputTokens || 0;
    // Approximate cost: Haiku input $1/1M, output $5/1M
    const costCents = (inputTokens / 1_000_000) * 100 + (outputTokens / 1_000_000) * 500;

    res.json({
      dailyBudgetCents,
      spentCents: Math.round(costCents * 100) / 100,
      inputTokens,
      outputTokens,
      isExceeded: dailyBudgetCents > 0 && costCents >= dailyBudgetCents,
      percentUsed: dailyBudgetCents > 0 ? Math.min(100, Math.round((costCents / dailyBudgetCents) * 100)) : 0,
    });
  } catch (error) {
    log('error', 'Get budget status failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get budget status' });
  }
});

// --- Rate Limit Status ---
router.get('/rate-limits', async (_req: Request, res: Response) => {
  try {
    const globalState = rateLimiter.getGlobalState();
    res.json({
      global: globalState,
    });
  } catch (error) {
    log('error', 'Get rate limits failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get rate limits' });
  }
});

// --- Blocked Users ---
router.get('/blocked-users', async (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const users = db.prepare(`
      SELECT id, handle, display_name as displayName, created_at as createdAt
      FROM users WHERE is_blocked = 1
      ORDER BY updated_at DESC
    `).all();
    res.json({ users });
  } catch (error) {
    log('error', 'Get blocked users failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get blocked users' });
  }
});

// --- Block / Unblock User ---
router.post('/users/:userId/block', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { userId } = req.params;
    db.prepare('UPDATE users SET is_blocked = 1, updated_at = datetime(\'now\') WHERE id = ?').run(userId);
    log('info', 'User blocked', { userId });
    res.json({ success: true });
  } catch (error) {
    log('error', 'Block user failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to block user' });
  }
});

router.post('/users/:userId/unblock', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { userId } = req.params;
    db.prepare('UPDATE users SET is_blocked = 0, updated_at = datetime(\'now\') WHERE id = ?').run(userId);
    log('info', 'User unblocked', { userId });
    res.json({ success: true });
  } catch (error) {
    log('error', 'Unblock user failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

export default router;
