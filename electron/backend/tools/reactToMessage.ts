import { iMessageService } from '../services/iMessageService';
import type { ToolCallContext } from '../services/ToolRegistry';
import { log } from '../logger';

const REACTION_EMOJI: Record<string, string> = {
  love: '❤️',
  like: '👍',
  dislike: '👎',
  laugh: '😂',
  emphasize: '‼️',
  question: '❓',
};

/**
 * react_to_message tool — sends a tapback-style reaction to the conversation.
 *
 * NOTE: macOS Messages.app does not expose tapback reactions via AppleScript.
 * As a fallback, this sends the reaction emoji as a short text message.
 * Upgrade path: native IMCore helper or BlueBubbles integration for real tapbacks.
 */
export async function reactToMessage(
  input: Record<string, unknown>,
  context: ToolCallContext
): Promise<string> {
  const reaction = input.reaction as string;

  if (!reaction || !REACTION_EMOJI[reaction]) {
    throw new Error(`Invalid reaction: ${reaction}. Must be one of: ${Object.keys(REACTION_EMOJI).join(', ')}`);
  }

  const emoji = REACTION_EMOJI[reaction];

  // Send emoji as text message (real tapback not available via AppleScript)
  const sent = await iMessageService.sendMessage(context.chatGuid, emoji);

  if (!sent) {
    throw new Error('Failed to send reaction');
  }

  log('info', 'Reaction sent', { reaction, emoji, chatGuid: context.chatGuid });
  return `Sent ${reaction} reaction (${emoji}) to the conversation`;
}

export const reactToMessageDefinition = {
  name: 'react_to_message',
  description: "Send a tapback reaction (emoji) to the user's last message in the conversation. Use this tool instead of sending an emoji as a text message — tapback reactions are more natural in iMessage. Call this for acknowledgments (like), gratitude or good news (love), humor (laugh), important messages (emphasize), or confusing messages (question). You can pair this with the 'wait' tool when no text reply is needed, or use it alongside a text response for emphasis. Do NOT use this tool when the user's message is itself a tapback reaction (e.g. 'Liked ...' or 'Loved ...').",
  type: 'custom' as const,
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      reaction: {
        type: 'string',
        enum: ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'],
        description: 'The reaction type: love=❤️, like=👍, dislike=👎, laugh=😂, emphasize=‼️, question=❓',
      },
    },
    required: ['reaction'],
  },
};
