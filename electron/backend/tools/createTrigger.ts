import crypto from 'crypto';
import { getDatabase } from '../database';
import { log } from '../logger';
import type { ToolCallContext } from '../services/ToolRegistry';

/**
 * createTrigger tool — creates a recurring trigger that fires on a schedule.
 * Triggers are stored in the database and checked by TriggerService.
 */
export async function createTrigger(
  input: Record<string, unknown>,
  context: ToolCallContext
): Promise<string> {
  const message = input.message as string;
  const schedule = input.schedule as string;
  const name = (input.name as string) || message.substring(0, 50);

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw new Error('message is required and must be a non-empty string');
  }

  if (!schedule || typeof schedule !== 'string') {
    throw new Error('schedule is required (e.g., "daily 9:00", "weekly monday 8:00", "every 2 hours")');
  }

  // Validate schedule format (simple patterns)
  const validPatterns = [
    /^daily\s+\d{1,2}:\d{2}$/i,
    /^weekly\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+\d{1,2}:\d{2}$/i,
    /^every\s+\d+\s+(hour|hours|minute|minutes|day|days)$/i,
  ];

  if (!validPatterns.some((p) => p.test(schedule.trim()))) {
    throw new Error(
      'Invalid schedule format. Use: "daily HH:MM", "weekly DAY HH:MM", or "every N hours/minutes/days"'
    );
  }

  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO triggers (id, user_id, chat_guid, name, message, schedule)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, context.userId, context.chatGuid, name.trim(), message.trim(), schedule.trim().toLowerCase());

  log('info', 'Trigger created', { id, userId: context.userId, schedule: schedule.trim() });

  return `Trigger created: "${name.trim()}" — will send "${message.trim()}" on schedule: ${schedule.trim()} (id: ${id})`;
}

export const createTriggerDefinition = {
  name: 'create_trigger',
  description: 'Create a recurring message trigger on a schedule. Use this when the user wants to receive regular messages, like daily check-ins, weekly reminders, or periodic updates.',
  type: 'custom' as const,
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The message to send each time the trigger fires.',
      },
      schedule: {
        type: 'string',
        description: 'Schedule in simple format: "daily HH:MM", "weekly DAY HH:MM", or "every N hours/minutes/days".',
      },
      name: {
        type: 'string',
        description: 'Optional friendly name for this trigger.',
      },
    },
    required: ['message', 'schedule'],
  },
};
