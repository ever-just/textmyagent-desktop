import { log } from '../logger';
import { getDatabase, getSettingBool, getSettingInt } from '../database';
import type { ToolDefinition, ToolCall, ToolResult, ToolExecution } from '../types';
import crypto from 'crypto';

/**
 * ToolRegistry — manages tool definitions, dispatch, and execution logging.
 * Phase 3, Task 3.1
 *
 * All tools are custom tools executed locally with registered handler functions.
 */

type ToolHandler = (input: Record<string, unknown>, context: ToolCallContext) => Promise<string>;

export interface ToolCallContext {
  userId: string;
  chatGuid: string;
}

export class ToolRegistry {
  private customHandlers: Map<string, ToolHandler> = new Map();
  private definitions: Map<string, ToolDefinition> = new Map();

  constructor() {
    this.registerBuiltinDefinitions();
  }

  /**
   * Register built-in tool definitions.
   */
  registerBuiltinDefinitions(): void {
    // No built-in tools — all tools registered via registerCustomTool()
  }

  /**
   * Register a custom tool with a local handler function.
   */
  registerCustomTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.definitions.set(definition.name, definition);
    this.customHandlers.set(definition.name, handler);
    log('info', `Tool registered: ${definition.name}`, { type: definition.type });
  }

  /**
   * Return all enabled tool definitions (used by LocalLLMService and dashboard).
   */
  getEnabledDefinitions(): ToolDefinition[] {
    const result: ToolDefinition[] = [];
    for (const [name, def] of this.definitions) {
      if (!def.enabled) continue;
      if (!this.isToolEnabledInSettings(name)) continue;
      result.push(def);
    }
    return result;
  }

  /**
   * Execute a custom tool call.
   */
  async executeToolCall(toolCall: ToolCall, context: ToolCallContext): Promise<ToolResult> {
    const startTime = Date.now();
    const def = this.definitions.get(toolCall.name);

    if (!def) {
      return {
        toolCallId: toolCall.id,
        content: `Unknown tool: ${toolCall.name}`,
        isError: true,
      };
    }

    const handler = this.customHandlers.get(toolCall.name);
    if (!handler) {
      return {
        toolCallId: toolCall.id,
        content: `No handler registered for tool: ${toolCall.name}`,
        isError: true,
      };
    }

    try {
      const output = await handler(toolCall.input, context);
      const durationMs = Date.now() - startTime;

      this.logExecution(toolCall, context, output, false, durationMs);

      return {
        toolCallId: toolCall.id,
        content: output,
        isError: false,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error.message || 'Tool execution failed';

      this.logExecution(toolCall, context, errorMsg, true, durationMs);
      log('error', 'Tool execution failed', { tool: toolCall.name, error: errorMsg });

      return {
        toolCallId: toolCall.id,
        content: errorMsg,
        isError: true,
      };
    }
  }

  /**
   * Check if a tool is enabled in settings.
   */
  private isToolEnabledInSettings(toolName: string): boolean {
    const settingsMap: Record<string, string> = {
      web_search: 'tools.webSearch',
      web_fetch: 'tools.webFetch',
      save_user_fact: 'tools.saveUserFact',
      get_user_facts: 'tools.getUserFacts',
      search_history: 'tools.searchHistory',
      set_reminder: 'tools.reminders',
      create_trigger: 'tools.triggers',
      wait: 'tools.waitTool',
    };

    const settingKey = settingsMap[toolName];
    if (!settingKey) return true; // Unknown tool — default to enabled
    return getSettingBool(settingKey, true);
  }

  /**
   * Log a tool execution to the database.
   */
  private logExecution(
    toolCall: ToolCall,
    context: ToolCallContext,
    output: string,
    isError: boolean,
    durationMs: number
  ): void {
    try {
      const db = getDatabase();
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO tool_executions (id, tool_name, user_id, input, output, is_error, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        toolCall.name,
        context.userId,
        JSON.stringify(toolCall.input),
        output.substring(0, 5000), // Cap output size
        isError ? 1 : 0,
        durationMs
      );
    } catch (err) {
      // Don't let logging failure break tool execution
      console.error('[ToolRegistry] Failed to log execution:', err);
    }
  }

  /**
   * Get tool definitions (for dashboard display).
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * Get recent tool executions (for dashboard display).
   */
  getRecentExecutions(limit = 50): ToolExecution[] {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT id, tool_name as toolName, user_id as userId,
               input, output, is_error as isError, duration_ms as durationMs,
               tokens_used as tokensUsed, created_at as createdAt
        FROM tool_executions
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit) as any[];

      return rows.map((row) => ({
        id: row.id,
        toolName: row.toolName,
        userId: row.userId,
        input: row.input ? JSON.parse(row.input) : {},
        output: row.output,
        isError: !!row.isError,
        durationMs: row.durationMs,
        tokensUsed: row.tokensUsed || 0,
        createdAt: row.createdAt,
      }));
    } catch {
      return [];
    }
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();
