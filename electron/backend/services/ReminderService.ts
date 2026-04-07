import { getDatabase } from '../database';
import { log } from '../logger';
import { iMessageService } from './iMessageService';

/**
 * ReminderService — background checker that sends due reminders via iMessage.
 * Phase 3, Task 3.4
 *
 * Runs on a 30-second interval, queries for unsent reminders whose due_at has passed,
 * sends them via iMessage, and marks them as sent.
 */

interface ReminderRow {
  id: string;
  user_id: string;
  chat_guid: string;
  message: string;
  due_at: string;
}

export class ReminderService {
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private static CHECK_INTERVAL_MS = 30_000; // 30 seconds

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    log('info', 'ReminderService started');
    this.checkInterval = setInterval(() => this.checkDueReminders(), ReminderService.CHECK_INTERVAL_MS);
    // Also run immediately
    this.checkDueReminders();
  }

  stop(): void {
    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    log('info', 'ReminderService stopped');
  }

  private async checkDueReminders(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const db = getDatabase();
      const now = new Date().toISOString();

      const dueReminders = db.prepare(`
        SELECT id, user_id, chat_guid, message, due_at
        FROM reminders
        WHERE is_sent = 0 AND due_at <= ?
        ORDER BY due_at ASC
        LIMIT 10
      `).all(now) as ReminderRow[];

      for (const reminder of dueReminders) {
        try {
          const sent = await iMessageService.sendMessage(
            reminder.chat_guid,
            `Reminder: ${reminder.message}`
          );

          if (sent) {
            db.prepare('UPDATE reminders SET is_sent = 1 WHERE id = ?').run(reminder.id);
            log('info', 'Reminder delivered', { id: reminder.id, chatGuid: reminder.chat_guid });
          } else {
            log('warn', 'Failed to send reminder', { id: reminder.id });
          }
        } catch (err: any) {
          log('error', 'Error sending reminder', { id: reminder.id, error: err.message });
        }
      }
    } catch (err: any) {
      log('error', 'ReminderService check failed', { error: err.message });
    }
  }
}

// Singleton instance
export const reminderService = new ReminderService();
