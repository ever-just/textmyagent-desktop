import { log } from '../logger';
import type { ToolCallContext } from '../services/ToolRegistry';

/**
 * wait tool — lets the AI choose not to send a text response.
 *
 * Use cases:
 * - User sent a simple acknowledgment ("ok", "got it", "k")
 * - User sent gratitude ("thanks", "ty")
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
  description: 'Choose not to send any text response to the user. Call this tool when replying with text would be unnecessary or awkward — for example, after simple acknowledgments (ok, got it, k), gratitude (thanks, ty), goodbyes (bye, ttyl, gn), or when the user sent a tapback reaction. When in doubt about whether to respond, prefer sending a short text reply over calling wait — silence should be intentional, not a default. The reason parameter should briefly explain why no text response is needed.',
  type: 'custom' as const,
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Brief explanation of why waiting (e.g., "user said thanks", "acknowledgment only", "goodbye").',
      },
    },
    required: ['reason'],
  },
};
