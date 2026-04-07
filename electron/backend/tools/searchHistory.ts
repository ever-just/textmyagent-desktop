import { getDatabase } from '../database';
import type { ToolCallContext } from '../services/ToolRegistry';

/**
 * searchHistory tool — full-text search across the messages table.
 * Called by the AI to look up past conversations.
 */
export async function searchHistory(
  input: Record<string, unknown>,
  context: ToolCallContext
): Promise<string> {
  const query = input.query as string;
  const limit = Math.min(Number(input.limit) || 10, 20);

  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    throw new Error('query is required and must be at least 2 characters');
  }

  const db = getDatabase();
  const searchPattern = `%${query.trim()}%`;

  const rows = db.prepare(`
    SELECT m.user_message, m.assistant_response, m.created_at,
           u.handle, u.display_name
    FROM messages m
    LEFT JOIN users u ON m.user_id = u.id
    WHERE m.user_message LIKE ? OR m.assistant_response LIKE ?
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(searchPattern, searchPattern, limit) as any[];

  if (rows.length === 0) {
    return `No messages found matching "${query}".`;
  }

  const results = rows.map((r, i) => {
    const who = r.display_name || r.handle || 'Unknown';
    const date = new Date(r.created_at).toLocaleDateString();
    return `${i + 1}. [${date}] ${who}: "${r.user_message}" → "${r.assistant_response?.substring(0, 100) || '...'}"`;
  });

  return `Found ${rows.length} message(s) matching "${query}":\n${results.join('\n')}`;
}

export const searchHistoryDefinition = {
  name: 'search_history',
  description: 'Search through past message history for specific topics, keywords, or conversations. Use this when the user asks about something you discussed before or when you need to find a previous conversation.',
  type: 'custom' as const,
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search term or keyword to look for in past messages.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default 10, max 20).',
      },
    },
    required: ['query'],
  },
};
