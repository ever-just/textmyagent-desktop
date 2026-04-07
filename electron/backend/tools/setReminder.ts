import crypto from 'crypto';
import { getDatabase } from '../database';
import { log } from '../logger';
import type { ToolCallContext } from '../services/ToolRegistry';

/**
 * setReminder tool — creates a reminder for the user at a future time.
 * Reminders are stored in the database and checked by ReminderService.
 */
export async function setReminder(
  input: Record<string, unknown>,
  context: ToolCallContext
): Promise<string> {
  const message = input.message as string;
  const dueAtRaw = input.due_at as string;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw new Error('message is required and must be a non-empty string');
  }

  if (!dueAtRaw || typeof dueAtRaw !== 'string') {
    throw new Error('due_at is required and must be an ISO 8601 datetime string');
  }

  // Parse and validate the due date
  const dueAt = new Date(dueAtRaw);
  if (isNaN(dueAt.getTime())) {
    throw new Error('due_at must be a valid ISO 8601 datetime (e.g., 2025-01-15T14:30:00)');
  }

  // Must be in the future
  if (dueAt.getTime() <= Date.now()) {
    throw new Error('due_at must be in the future');
  }

  // Cap at 1 year from now
  const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  if (dueAt.getTime() > oneYearFromNow.getTime()) {
    throw new Error('due_at must be within 1 year from now');
  }

  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO reminders (id, user_id, chat_guid, message, due_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, context.userId, context.chatGuid, message.trim(), dueAt.toISOString());

  log('info', 'Reminder created', { id, userId: context.userId, dueAt: dueAt.toISOString() });

  const formattedTime = dueAt.toLocaleString();
  return `Reminder set for ${formattedTime}: "${message.trim()}" (id: ${id})`;
}

export const setReminderDefinition = {
  name: 'set_reminder',
  description: 'Set a reminder for the user at a specific future time. The user will receive a message when the reminder is due. Use this when the user asks to be reminded about something.',
  type: 'custom' as const,
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The reminder message to send to the user when the time comes.',
      },
      due_at: {
        type: 'string',
        description: 'When to send the reminder, in ISO 8601 format (e.g., "2025-01-15T14:30:00"). Must be in the future.',
      },
    },
    required: ['message', 'due_at'],
  },
};
