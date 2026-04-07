import { Router, Request, Response } from 'express';
import { toolRegistry } from '../services/ToolRegistry';
import { getDatabase } from '../database';
import { log } from '../logger';

const router = Router();

// --- Tool Definitions ---
router.get('/definitions', async (_req: Request, res: Response) => {
  try {
    const definitions = toolRegistry.getDefinitions();
    res.json({ tools: definitions });
  } catch (error) {
    log('error', 'Get tool definitions failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get tool definitions' });
  }
});

// --- Recent Executions ---
router.get('/executions', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
    const executions = toolRegistry.getRecentExecutions(limit);
    res.json({ executions });
  } catch (error) {
    log('error', 'Get tool executions failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get tool executions' });
  }
});

// --- Reminders ---
router.get('/reminders', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { status } = req.query;

    let query = 'SELECT * FROM reminders';
    const params: any[] = [];

    if (status === 'pending') {
      query += ' WHERE is_sent = 0 AND due_at > datetime(\'now\')';
    } else if (status === 'sent') {
      query += ' WHERE is_sent = 1';
    } else if (status === 'overdue') {
      query += ' WHERE is_sent = 0 AND due_at <= datetime(\'now\')';
    }

    query += ' ORDER BY due_at ASC';

    const reminders = db.prepare(query).all(...params);
    res.json({ reminders });
  } catch (error) {
    // Table might not exist yet
    res.json({ reminders: [] });
  }
});

router.delete('/reminders/:id', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM reminders WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    log('error', 'Delete reminder failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

// --- Triggers ---
router.get('/triggers', async (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const triggers = db.prepare('SELECT * FROM triggers ORDER BY created_at DESC').all();
    res.json({ triggers });
  } catch (error) {
    // Table might not exist yet
    res.json({ triggers: [] });
  }
});

router.post('/triggers/:id/toggle', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const trigger = db.prepare('SELECT is_active FROM triggers WHERE id = ?').get(req.params.id) as { is_active: number } | undefined;
    if (!trigger) return res.status(404).json({ error: 'Trigger not found' });

    const newState = trigger.is_active ? 0 : 1;
    db.prepare('UPDATE triggers SET is_active = ? WHERE id = ?').run(newState, req.params.id);
    res.json({ success: true, isActive: !!newState });
  } catch (error) {
    log('error', 'Toggle trigger failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to toggle trigger' });
  }
});

router.delete('/triggers/:id', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM triggers WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    log('error', 'Delete trigger failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete trigger' });
  }
});

export default router;
