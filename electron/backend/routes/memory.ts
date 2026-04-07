import { Router, Request, Response } from 'express';
import { memoryService } from '../services/MemoryService';
import { log } from '../logger';

const router = Router();

// --- User Facts ---
router.get('/facts', async (req: Request, res: Response) => {
  try {
    const { userId, type } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter is required' });
    }
    const facts = memoryService.getUserFacts(
      userId as string,
      type as any || undefined
    );
    res.json({ facts });
  } catch (error) {
    log('error', 'Get facts failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get facts' });
  }
});

router.post('/facts', async (req: Request, res: Response) => {
  try {
    const { userId, content, type, source, confidence } = req.body;
    if (!userId || !content) {
      return res.status(400).json({ error: 'userId and content are required' });
    }
    const fact = memoryService.saveFact(userId, content, type, source, confidence);
    res.json({ fact });
  } catch (error) {
    log('error', 'Save fact failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to save fact' });
  }
});

router.delete('/facts/:factId', async (req: Request, res: Response) => {
  try {
    const deleted = memoryService.deleteFact(req.params.factId);
    res.json({ success: deleted });
  } catch (error) {
    log('error', 'Delete fact failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete fact' });
  }
});

router.delete('/facts/user/:userId', async (req: Request, res: Response) => {
  try {
    const count = memoryService.deleteUserFacts(req.params.userId);
    res.json({ success: true, deletedCount: count });
  } catch (error) {
    log('error', 'Purge user facts failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to purge user facts' });
  }
});

// --- Conversation Summaries ---
router.get('/summaries/:conversationId', async (req: Request, res: Response) => {
  try {
    const summaries = memoryService.getConversationSummaries(req.params.conversationId);
    res.json({ summaries });
  } catch (error) {
    log('error', 'Get summaries failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get summaries' });
  }
});

// --- Stats ---
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = memoryService.getStats();
    res.json(stats);
  } catch (error) {
    log('error', 'Get memory stats failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get memory stats' });
  }
});

// --- Export ---
router.get('/export', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;
    if (userId) {
      const facts = memoryService.exportUserFacts(userId as string);
      res.json({ userId, facts });
    } else {
      const allFacts = memoryService.exportAllFacts();
      res.json({ users: allFacts });
    }
  } catch (error) {
    log('error', 'Export facts failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to export facts' });
  }
});

// --- Expire old facts ---
router.post('/expire', async (_req: Request, res: Response) => {
  try {
    const count = memoryService.expireOldFacts();
    res.json({ success: true, expiredCount: count });
  } catch (error) {
    log('error', 'Expire facts failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to expire facts' });
  }
});

export default router;
