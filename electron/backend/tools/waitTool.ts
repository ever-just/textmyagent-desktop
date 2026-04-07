import { log } from '../logger';
import type { ToolCallContext } from '../services/ToolRegistry';

/**
 * wait tool — lets the AI choose not to send a text response.
 *
 * Use cases:
 * - User sent a simple acknowledgment ("ok", "got it", "k")
 * - User sent gratitude ("thanks", "ty") — pair with react_to_message
 * - User sent a goodbye ("bye", "ttyl")
 * - User sent a tapback reaction
 * - No response is needed for the current message
 */
export async function waitTool(
  input: Record<string, unknown>,
  _context: ToolCallContext
): Promise<string> {
  const reason = (input.reason as string) || 'No response needed';

  log('info', 'Agent chose to wait (no response)', { reason });

  return `Waiting silently. Reason: ${reason}`;
}

export const waitToolDefinition = {
  name: 'wait',
  description: 'Choose not to send a text response. Use when no reply is needed: simple acknowledgments (ok/got it/k), gratitude (thanks/ty), goodbyes (bye/ttyl), or when you already reacted with react_to_message and no text is needed.',
  type: 'custom' as const,
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Brief explanation of why waiting (e.g., "user said thanks", "acknowledgment only", "reacted instead").',
      },
    },
    required: ['reason'],
  },
};
