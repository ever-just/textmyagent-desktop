import { getDatabase } from '../database';
import { log } from '../logger';
import { iMessageService } from './iMessageService';

/**
 * TriggerService — background checker that fires recurring triggers on schedule.
 * Phase 3, Task 3.6
 *
 * Runs on a 60-second interval, queries for active triggers whose schedule
 * indicates they should fire, sends them via iMessage, and updates last_fired_at.
 *
 * Schedule formats:
 *   "daily HH:MM"
 *   "weekly DAY HH:MM"
 *   "every N hours/minutes/days"
 */

interface TriggerRow {
  id: string;
  user_id: string;
  chat_guid: string;
  name: string;
  message: string;
  schedule: string;
  last_fired_at: string | null;
}

export class TriggerService {
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private static CHECK_INTERVAL_MS = 60_000; // 1 minute

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    log('info', 'TriggerService started');
    this.checkInterval = setInterval(() => this.checkDueTriggers(), TriggerService.CHECK_INTERVAL_MS);
    // Also run immediately
    this.checkDueTriggers();
  }

  stop(): void {
    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    log('info', 'TriggerService stopped');
  }

  private async checkDueTriggers(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const db = getDatabase();
      const activeTriggers = db.prepare(`
        SELECT id, user_id, chat_guid, name, message, schedule, last_fired_at
        FROM triggers
        WHERE is_active = 1
      `).all() as TriggerRow[];

      const now = new Date();

      for (const trigger of activeTriggers) {
        if (this.shouldFire(trigger, now)) {
          try {
            const sent = await iMessageService.sendMessage(
              trigger.chat_guid,
              trigger.message
            );

            if (sent) {
              db.prepare('UPDATE triggers SET last_fired_at = ? WHERE id = ?')
                .run(now.toISOString(), trigger.id);
              log('info', 'Trigger fired', { id: trigger.id, name: trigger.name });
            } else {
              log('warn', 'Failed to send trigger message', { id: trigger.id });
            }
          } catch (err: any) {
            log('error', 'Error firing trigger', { id: trigger.id, error: err.message });
          }
        }
      }
    } catch (err: any) {
      log('error', 'TriggerService check failed', { error: err.message });
    }
  }

  /**
   * Determine if a trigger should fire based on its schedule and last_fired_at.
   */
  private shouldFire(trigger: TriggerRow, now: Date): boolean {
    const schedule = trigger.schedule.toLowerCase().trim();
    const lastFired = trigger.last_fired_at ? new Date(trigger.last_fired_at) : null;

    // --- "every N unit" ---
    const everyMatch = schedule.match(/^every\s+(\d+)\s+(hour|hours|minute|minutes|day|days)$/);
    if (everyMatch) {
      const count = parseInt(everyMatch[1], 10);
      const unit = everyMatch[2].replace(/s$/, ''); // normalize plural
      let intervalMs: number;
      switch (unit) {
        case 'minute': intervalMs = count * 60_000; break;
        case 'hour':   intervalMs = count * 3_600_000; break;
        case 'day':    intervalMs = count * 86_400_000; break;
        default: return false;
      }

      if (!lastFired) return true; // never fired
      return (now.getTime() - lastFired.getTime()) >= intervalMs;
    }

    // --- "daily HH:MM" ---
    const dailyMatch = schedule.match(/^daily\s+(\d{1,2}):(\d{2})$/);
    if (dailyMatch) {
      const targetHour = parseInt(dailyMatch[1], 10);
      const targetMinute = parseInt(dailyMatch[2], 10);

      // Check if we're within the firing window (current minute matches target)
      if (now.getHours() !== targetHour || now.getMinutes() !== targetMinute) return false;

      // Don't fire if already fired today
      if (lastFired && this.isSameDay(lastFired, now)) return false;
      return true;
    }

    // --- "weekly DAY HH:MM" ---
    const weeklyMatch = schedule.match(/^weekly\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2}):(\d{2})$/);
    if (weeklyMatch) {
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = dayNames.indexOf(weeklyMatch[1]);
      const targetHour = parseInt(weeklyMatch[2], 10);
      const targetMinute = parseInt(weeklyMatch[3], 10);

      if (now.getDay() !== targetDay) return false;
      if (now.getHours() !== targetHour || now.getMinutes() !== targetMinute) return false;

      // Don't fire if already fired today
      if (lastFired && this.isSameDay(lastFired, now)) return false;
      return true;
    }

    return false;
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }
}

// Singleton instance
export const triggerService = new TriggerService();
