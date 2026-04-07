import Anthropic from '@anthropic-ai/sdk';
import { SecureStorage } from '../../utils/secure-storage';
import { log } from '../logger';
import { getDatabase, recordApiUsage, getSettingInt, getSettingBool } from '../database';
import { promptBuilder } from './PromptBuilder';
import { toolRegistry, ToolCallContext } from './ToolRegistry';
import type { PromptContext } from '../types';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
}

export class ClaudeService {
  private client: Anthropic | null = null;
  private model = 'claude-haiku-4-5-20251001';
  private maxTokens = 256;
  private temperature = 0.7;
  private initialized = false;

  constructor() {
    // Don't initialize in constructor - wait for Electron app to be ready
  }

  private initClient(): void {
    if (this.initialized && this.client) return;
    
    try {
      const apiKey = SecureStorage.getAnthropicApiKey();
      if (apiKey) {
        this.client = new Anthropic({ apiKey, maxRetries: 3 });
        this.initialized = true;
        log('info', 'Claude client initialized');
      } else {
        // Don't set initialized=true if no key — allow retry later (fixes B10)
        this.client = null;
      }
    } catch (error: any) {
      // Electron app may not be ready yet
      this.initialized = false;
      this.client = null;
      console.log('[ClaudeService] Deferred initialization:', error.message);
    }
  }

  refreshClient(): void {
    this.initialized = false;
    this.client = null;
    this.initClient();
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async generateResponse(
    userMessage: string,
    conversationHistory: Message[] = [],
    systemPrompt?: string,
    promptContext?: Partial<PromptContext>,
    toolContext?: ToolCallContext
  ): Promise<ClaudeResponse | null> {
    if (!this.client) {
      this.initClient();
      if (!this.client) {
        log('error', 'Claude client not configured');
        return null;
      }
    }

    const maxApiCalls = getSettingInt('security.maxApiCallsPerMessage', 6);
    const toolsEnabled = getSettingBool('tools.enabled', true);

    try {
      // Build messages array
      const messages: Anthropic.MessageParam[] = [
        ...conversationHistory.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user' as const, content: userMessage },
      ];

      // Build system prompt via PromptBuilder with cache control (Phase 2a, task 2.5)
      // Uses cache_control blocks so static sections are cached across requests
      const systemBlocks = systemPrompt
        ? [{ type: 'text' as const, text: systemPrompt }]
        : promptBuilder.buildWithCacheControl(promptContext || { date: new Date().toLocaleString() });

      // Get available tools
      const tools = toolsEnabled ? toolRegistry.getAnthropicTools() : [];

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let apiCallCount = 0;
      let finalContent = '';
      let lastStopReason = 'end_turn';

      // Agentic loop: keep calling Claude until we get a text response (no more tool_use)
      while (apiCallCount < maxApiCalls) {
        apiCallCount++;

        const requestParams: any = {
          model: this.model,
          max_tokens: this.maxTokens,
          temperature: this.temperature,
          system: systemBlocks,
          messages,
        };

        // Only include tools if we have them and haven't exceeded the call limit
        if (tools.length > 0 && apiCallCount < maxApiCalls) {
          requestParams.tools = tools;
        }

        const response = await this.client.messages.create(requestParams);

        // Record API usage
        totalInputTokens += response.usage.input_tokens;
        totalOutputTokens += response.usage.output_tokens;
        recordApiUsage(response.usage.input_tokens, response.usage.output_tokens, this.model);

        lastStopReason = response.stop_reason || 'end_turn';

        log('info', `Claude API call #${apiCallCount}`, {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          stopReason: response.stop_reason,
          contentBlocks: response.content.length,
        });

        // Check if response contains tool_use blocks
        const toolUseBlocks = response.content.filter((c) => c.type === 'tool_use');
        const textBlocks = response.content.filter((c) => c.type === 'text');

        // Accumulate text content
        for (const block of textBlocks) {
          if (block.type === 'text' && block.text) {
            finalContent += (finalContent ? '\n' : '') + block.text;
          }
        }

        // If no tool calls or stop reason is not tool_use, we're done
        if (toolUseBlocks.length === 0 || response.stop_reason !== 'tool_use') {
          break;
        }

        // Process tool calls
        // Add the assistant's response (with tool_use blocks) to messages
        messages.push({
          role: 'assistant',
          content: response.content as any,
        });

        // Execute each tool call and collect results
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUseBlocks) {
          if (block.type === 'tool_use') {
            const toolDef = toolRegistry.getDefinitions().find((d) => d.name === block.name);

            if (toolDef?.type === 'anthropic_server') {
              // Server-side tools are handled by Anthropic automatically
              // This shouldn't happen — Anthropic processes them internally
              continue;
            }

            // Execute custom tool
            const result = await toolRegistry.executeToolCall(
              { id: block.id, name: block.name, input: block.input as Record<string, unknown> },
              toolContext || { userId: 'unknown', chatGuid: 'unknown' }
            );

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result.content,
              is_error: result.isError,
            });
          }
        }

        // Add tool results as a user message
        if (toolResults.length > 0) {
          messages.push({
            role: 'user',
            content: toolResults as any,
          });
        }

        // Safety: if we're about to exceed the API call limit, break
        if (apiCallCount >= maxApiCalls) {
          log('warn', 'Max API calls per message reached', { maxApiCalls, apiCallCount });
          break;
        }
      }

      if (!finalContent) {
        log('warn', 'No text content in Claude response after tool loop');
        return null;
      }

      log('info', 'Claude response generated', {
        totalInputTokens,
        totalOutputTokens,
        apiCalls: apiCallCount,
        stopReason: lastStopReason,
      });

      return {
        content: finalContent,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        stopReason: lastStopReason,
      };
    } catch (error: any) {
      log('error', 'Claude API error', { error: error.message });

      // Handle specific error types
      if (error.status === 401) {
        log('error', 'Invalid Anthropic API key');
        return null;
      }

      return null;
    }
  }

  setModel(model: string): void {
    this.model = model;
  }

  setMaxTokens(tokens: number): void {
    this.maxTokens = tokens;
  }

  setTemperature(temp: number): void {
    this.temperature = temp;
  }
}

// Singleton instance
export const claudeService = new ClaudeService();
