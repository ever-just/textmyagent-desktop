import { memoryService } from '../services/MemoryService';
import type { ToolCallContext } from '../services/ToolRegistry';

/**
 * saveUserFact tool — saves a fact about a user to the memory system.
 * Called by the AI when it learns something worth remembering.
 */
export async function saveUserFact(
  input: Record<string, unknown>,
  context: ToolCallContext
): Promise<string> {
  const content = input.content as string;
  const type = (input.type as string) || 'general';

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('content is required and must be a non-empty string');
  }

  const validTypes = ['preference', 'personal', 'behavioral', 'general'];
  if (!validTypes.includes(type)) {
    throw new Error(`type must be one of: ${validTypes.join(', ')}`);
  }

  const fact = memoryService.saveFact(
    context.userId,
    content.trim(),
    type as any,
    'ai_extracted',
    0.8
  );

  return `Saved fact: "${fact.content}" (type: ${fact.type}, id: ${fact.id})`;
}

export const saveUserFactDefinition = {
  name: 'save_user_fact',
  description: 'Save a fact or preference about the user you are talking to. Use this when you learn something worth remembering about the person, like their name, preferences, habits, or important details they share.',
  type: 'custom' as const,
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The fact to save about the user. Be concise and specific.',
      },
      type: {
        type: 'string',
        enum: ['preference', 'personal', 'behavioral', 'general'],
        description: 'Category of the fact. preference=likes/dislikes, personal=name/location/job, behavioral=communication style, general=other.',
      },
    },
    required: ['content'],
  },
};
