import { memoryService } from '../services/MemoryService';
import type { ToolCallContext } from '../services/ToolRegistry';

/**
 * getUserFacts tool — retrieves stored facts about the current user.
 * Called by the AI to recall what it knows about someone.
 */
export async function getUserFacts(
  input: Record<string, unknown>,
  context: ToolCallContext
): Promise<string> {
  const type = input.type as string | undefined;
  const facts = memoryService.getUserFacts(context.userId, type as any);

  if (facts.length === 0) {
    return 'No facts stored about this user yet.';
  }

  // Touch each fact so last_used_at updates
  for (const fact of facts) {
    memoryService.touchFact(fact.id);
  }

  const lines = facts.map((f) => `- [${f.type}] ${f.content}`);
  return `Known facts about this user (${facts.length}):\n${lines.join('\n')}`;
}

export const getUserFactsDefinition = {
  name: 'get_user_facts',
  description: 'Retrieve facts you have previously saved about the user you are talking to. Use this to recall their name, preferences, or other details you learned in past conversations.',
  type: 'custom' as const,
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['preference', 'personal', 'behavioral', 'general'],
        description: 'Optional filter by fact category. Omit to get all facts.',
      },
    },
    required: [],
  },
};
