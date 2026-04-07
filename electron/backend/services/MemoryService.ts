import crypto from 'crypto';
import { getDatabase, getSettingInt } from '../database';
import { log } from '../logger';
import type { UserFact, ConversationSummary } from '../types';

/**
 * MemoryService — user facts CRUD, conversation summarization, and expiration.
 * Phase 2b, Task 2.5
 */

interface UserFactRow {
  id: string;
  user_id: string;
  type: string;
  content: string;
  source: string;
  confidence: number;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface ConversationSummaryRow {
  id: string;
  conversation_id: string;
  summary: string;
  message_range_start: string | null;
  message_range_end: string | null;
  created_at: string;
}

export class MemoryService {
  // --- User Facts CRUD ---

  saveFact(
    userId: string,
    content: string,
    type: UserFact['type'] = 'general',
    source = 'ai_extracted',
    confidence = 0.8
  ): UserFact {
    const db = getDatabase();
    const maxFacts = getSettingInt('memory.maxFactsPerUser', 50);
    const ttlDays = getSettingInt('memory.factTTLDays', 90);

    // Check for duplicate/similar content first
    const existing = db.prepare(
      'SELECT id FROM user_facts WHERE user_id = ? AND content = ?'
    ).get(userId, content) as { id: string } | undefined;

    if (existing) {
      // Update last_used_at instead of creating duplicate
      db.prepare('UPDATE user_facts SET last_used_at = datetime(\'now\') WHERE id = ?').run(existing.id);
      return this.getFact(existing.id)!;
    }

    // Enforce max facts per user — evict oldest if at limit
    const count = db.prepare(
      'SELECT COUNT(*) as count FROM user_facts WHERE user_id = ?'
    ).get(userId) as { count: number };

    if (count.count >= maxFacts) {
      // Delete the oldest fact (by created_at) that hasn't been recently used
      db.prepare(`
        DELETE FROM user_facts WHERE id = (
          SELECT id FROM user_facts WHERE user_id = ?
          ORDER BY COALESCE(last_used_at, created_at) ASC LIMIT 1
        )
      `).run(userId);
    }

    const id = crypto.randomUUID();
    const expiresAt = ttlDays > 0
      ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    db.prepare(`
      INSERT INTO user_facts (id, user_id, type, content, source, confidence, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, type, content, source, confidence, expiresAt);

    log('info', 'User fact saved', { userId, type, factId: id });
    return this.getFact(id)!;
  }

  getFact(factId: string): UserFact | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM user_facts WHERE id = ?').get(factId) as UserFactRow | undefined;
    return row ? this.mapFactRow(row) : null;
  }

  getUserFacts(userId: string, type?: UserFact['type']): UserFact[] {
    const db = getDatabase();
    let query = 'SELECT * FROM user_facts WHERE user_id = ?';
    const params: any[] = [userId];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    // Exclude expired facts
    query += ' AND (expires_at IS NULL OR expires_at > datetime(\'now\'))';
    query += ' ORDER BY COALESCE(last_used_at, created_at) DESC';

    const rows = db.prepare(query).all(...params) as UserFactRow[];
    return rows.map((r) => this.mapFactRow(r));
  }

  deleteFact(factId: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM user_facts WHERE id = ?').run(factId);
    return result.changes > 0;
  }

  deleteUserFacts(userId: string): number {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM user_facts WHERE user_id = ?').run(userId);
    log('info', 'User facts purged', { userId, count: result.changes });
    return result.changes;
  }

  /**
   * Touch a fact's last_used_at (call when fact is injected into prompt).
   */
  touchFact(factId: string): void {
    const db = getDatabase();
    db.prepare('UPDATE user_facts SET last_used_at = datetime(\'now\') WHERE id = ?').run(factId);
  }

  /**
   * Expire old facts. Call periodically (e.g., daily).
   */
  expireOldFacts(): number {
    const db = getDatabase();
    const result = db.prepare(
      'DELETE FROM user_facts WHERE expires_at IS NOT NULL AND expires_at < datetime(\'now\')'
    ).run();
    if (result.changes > 0) {
      log('info', 'Expired old user facts', { count: result.changes });
    }
    return result.changes;
  }

  // --- Conversation Summaries ---

  saveSummary(
    conversationId: string,
    summary: string,
    messageRangeStart?: string,
    messageRangeEnd?: string
  ): ConversationSummary {
    const db = getDatabase();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO conversation_summaries (id, conversation_id, summary, message_range_start, message_range_end)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, conversationId, summary, messageRangeStart || null, messageRangeEnd || null);

    log('info', 'Conversation summary saved', { conversationId, summaryId: id });
    return this.getSummary(id)!;
  }

  getSummary(summaryId: string): ConversationSummary | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM conversation_summaries WHERE id = ?').get(summaryId) as ConversationSummaryRow | undefined;
    return row ? this.mapSummaryRow(row) : null;
  }

  getConversationSummaries(conversationId: string, limit = 5): ConversationSummary[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM conversation_summaries WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(conversationId, limit) as ConversationSummaryRow[];
    return rows.map((r) => this.mapSummaryRow(r));
  }

  getLatestSummary(conversationId: string): ConversationSummary | null {
    const summaries = this.getConversationSummaries(conversationId, 1);
    return summaries[0] || null;
  }

  // --- Stats ---

  getStats(): { totalFacts: number; totalSummaries: number; factsByType: Record<string, number>; userCount: number } {
    const db = getDatabase();

    const totalFacts = (db.prepare('SELECT COUNT(*) as count FROM user_facts').get() as { count: number }).count;
    const totalSummaries = (db.prepare('SELECT COUNT(*) as count FROM conversation_summaries').get() as { count: number }).count;
    const userCount = (db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM user_facts').get() as { count: number }).count;

    const typeRows = db.prepare(
      'SELECT type, COUNT(*) as count FROM user_facts GROUP BY type'
    ).all() as { type: string; count: number }[];

    const factsByType: Record<string, number> = {};
    for (const row of typeRows) {
      factsByType[row.type] = row.count;
    }

    return { totalFacts, totalSummaries, factsByType, userCount };
  }

  // --- Export ---

  exportUserFacts(userId: string): UserFact[] {
    return this.getUserFacts(userId);
  }

  exportAllFacts(): { userId: string; facts: UserFact[] }[] {
    const db = getDatabase();
    const userIds = db.prepare(
      'SELECT DISTINCT user_id FROM user_facts ORDER BY user_id'
    ).all() as { user_id: string }[];

    return userIds.map((row) => ({
      userId: row.user_id,
      facts: this.getUserFacts(row.user_id),
    }));
  }

  // --- Private Helpers ---

  private mapFactRow(row: UserFactRow): UserFact {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type as UserFact['type'],
      content: row.content,
      source: row.source,
      confidence: row.confidence,
      lastUsedAt: row.last_used_at || row.created_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  private mapSummaryRow(row: ConversationSummaryRow): ConversationSummary {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      summary: row.summary,
      messageRange: {
        start: row.message_range_start || '',
        end: row.message_range_end || '',
      },
      createdAt: row.created_at,
    };
  }
}

// Singleton instance
export const memoryService = new MemoryService();
