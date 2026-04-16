/**
 * Tests for raw tool call stripping (Gemma 4 workaround).
 *
 * Covers:
 *   1. LocalLLMService.stripAndExecuteRawToolCalls — regex detection, tool
 *      execution fallback, and text cleanup.
 *   2. MessageFormatter sanitize layer — safety-net stripping of tool call
 *      artifacts that slip through.
 *   3. AgentService — empty-content-with-tools skip logic.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../../logger', () => ({
  log: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

vi.mock('../../database', () => ({
  getDatabase: () => ({
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn(),
    }),
  }),
  getSetting: () => null,
  setSetting: vi.fn(),
  getSettingInt: (_k: string, d: number) => d,
  getSettingBool: (_k: string, d: boolean) => d,
  getSettingFloat: (_k: string, d: number) => d,
  getSettingValue: (_k: string, d: any) => d,
  recordApiUsage: vi.fn(),
  seedDefaultSettings: vi.fn(),
}));

vi.mock('../ToolRegistry', () => ({
  toolRegistry: {
    executeToolCall: vi.fn().mockResolvedValue({ content: 'ok', isError: false }),
    getEnabledDefinitions: vi.fn().mockReturnValue([]),
  },
  ToolCallContext: {},
}));

vi.mock('../PromptBuilder', () => ({
  promptBuilder: {
    build: vi.fn().mockReturnValue('system prompt'),
  },
}));

import { LocalLLMService } from '../LocalLLMService';
import { toolRegistry } from '../ToolRegistry';
import { messageFormatter } from '../MessageFormatter';
import { log } from '../../logger';

// ---------------------------------------------------------------------------
// 1. stripAndExecuteRawToolCalls
// ---------------------------------------------------------------------------
describe('LocalLLMService.stripAndExecuteRawToolCalls', () => {
  let service: LocalLLMService;
  const ctx = { userId: 'test-user', chatGuid: 'iMessage;-;+15551234567' };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LocalLLMService();
  });

  it('should return empty input unchanged', async () => {
    expect(await service.stripAndExecuteRawToolCalls('', [], ctx)).toBe('');
  });

  it('should return clean text unchanged', async () => {
    const text = 'Hello! How are you?';
    const toolsUsed: string[] = [];
    const result = await service.stripAndExecuteRawToolCalls(text, toolsUsed, ctx);
    expect(result).toBe(text);
    expect(toolsUsed).toEqual([]);
    expect(toolRegistry.executeToolCall).not.toHaveBeenCalled();
  });

  // --- Pattern 1: Delimited tool call ---
  it('should strip delimited tool call and execute it', async () => {
    const raw = '<|tool_call>call: save_user_fact(params: {"content":"likes pizza","type":"preference"})<tool_call|>';
    const toolsUsed: string[] = [];
    const result = await service.stripAndExecuteRawToolCalls(raw, toolsUsed, ctx);

    expect(result).toBe('');
    expect(toolsUsed).toContain('save_user_fact');
    expect(toolRegistry.executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'save_user_fact',
        input: { content: 'likes pizza', type: 'preference' },
      }),
      ctx
    );
  });

  // --- Pattern 2: Delimited variant with pipe characters ---
  it('should strip <|tool_call|>...<|/tool_call|> variant', async () => {
    const raw = '<|tool_call|>call: wait(params: {"reason":"no reply needed"})<|/tool_call|>';
    const toolsUsed: string[] = [];
    const result = await service.stripAndExecuteRawToolCalls(raw, toolsUsed, ctx);

    expect(result).toBe('');
    expect(toolsUsed).toContain('wait');
  });

  // --- Mixed: text + tool call ---
  it('should preserve normal text and strip only the tool call portion', async () => {
    const raw = 'That sounds fun!\n<|tool_call>call: save_user_fact(params: {"content":"enjoys hiking","type":"preference"})<tool_call|>';
    const toolsUsed: string[] = [];
    const result = await service.stripAndExecuteRawToolCalls(raw, toolsUsed, ctx);

    expect(result).toBe('That sounds fun!');
    expect(toolsUsed).toContain('save_user_fact');
  });

  // --- Pattern 3: Bare call: on its own line ---
  it('should strip bare "call: tool(params: {...})" on its own line', async () => {
    const raw = 'call: save_user_fact(params: {"content":"lives in NYC","type":"personal"})';
    const toolsUsed: string[] = [];
    const result = await service.stripAndExecuteRawToolCalls(raw, toolsUsed, ctx);

    expect(result).toBe('');
    expect(toolsUsed).toContain('save_user_fact');
  });

  // --- Pattern 4: Token leak artifact <|"|"> ---
  it('should clean <|"|"> token leak artifacts from JSON and response', async () => {
    const raw = '<|tool_call>call: save_user_fact(params: {"content":<|"|>pizza<|"|>,"type":<|"|>preference<|"|>})<tool_call|>';
    const toolsUsed: string[] = [];
    const result = await service.stripAndExecuteRawToolCalls(raw, toolsUsed, ctx);

    expect(result).toBe('');
    // The JSON cleaning should have replaced <|"|"> with " before parsing
    expect(toolsUsed).toContain('save_user_fact');
  });

  // --- Stray markers ---
  it('should strip stray tool_call markers without content', async () => {
    const raw = 'Great talking to you! <|tool_call|>';
    const toolsUsed: string[] = [];
    const result = await service.stripAndExecuteRawToolCalls(raw, toolsUsed, ctx);

    expect(result).toBe('Great talking to you!');
    // No tool should be executed since there was no parseable call
    expect(toolRegistry.executeToolCall).not.toHaveBeenCalled();
  });

  // --- Generic special token leak ---
  it('should strip other leaked special tokens like eos markers', async () => {
    // Build string with special tokens using concatenation to avoid XML parser issues
    const marker = ['<', '|', 'eos', '|', '>'].join('');
    const raw = 'Hello there ' + marker;
    const toolsUsed: string[] = [];
    const result = await service.stripAndExecuteRawToolCalls(raw, toolsUsed, ctx);

    expect(result).toBe('Hello there');
  });

  // --- Duplicate prevention ---
  it('should not duplicate tool name in toolsUsed if already present', async () => {
    const raw = '<|tool_call>call: wait(params: {"reason":"test"})<tool_call|>';
    const toolsUsed: string[] = ['wait']; // already present
    await service.stripAndExecuteRawToolCalls(raw, toolsUsed, ctx);

    // Should still be exactly one 'wait'
    expect(toolsUsed.filter(t => t === 'wait').length).toBe(1);
  });

  // --- Malformed JSON ---
  it('should strip the text even if JSON params are malformed', async () => {
    const raw = '<|tool_call>call: save_user_fact(params: {INVALID JSON})<tool_call|>';
    const toolsUsed: string[] = [];
    const result = await service.stripAndExecuteRawToolCalls(raw, toolsUsed, ctx);

    expect(result).toBe('');
    // Tool execution was still attempted (with empty params due to parse failure)
    expect(toolRegistry.executeToolCall).toHaveBeenCalled();
  });

  // --- Tool execution failure should not throw ---
  it('should not throw if tool execution fails', async () => {
    vi.mocked(toolRegistry.executeToolCall).mockRejectedValueOnce(new Error('tool crashed'));
    const raw = '<|tool_call>call: save_user_fact(params: {"content":"test"})<tool_call|>';
    const toolsUsed: string[] = [];

    // Should not throw
    const result = await service.stripAndExecuteRawToolCalls(raw, toolsUsed, ctx);
    expect(result).toBe('');
  });

  // --- Multiple tool calls ---
  it('should handle multiple tool calls in one response', async () => {
    const raw = [
      '<|tool_call>call: save_user_fact(params: {"content":"name is John","type":"personal"})<tool_call|>',
      'Nice to meet you John!',
      '<|tool_call>call: react_to_message(params: {"reaction":"love"})<tool_call|>',
    ].join('\n');
    const toolsUsed: string[] = [];
    const result = await service.stripAndExecuteRawToolCalls(raw, toolsUsed, ctx);

    expect(result).toBe('Nice to meet you John!');
    expect(toolsUsed).toContain('save_user_fact');
    // react_to_message should also be detected from second delimited block
    expect(toolRegistry.executeToolCall).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 2. MessageFormatter sanitize safety net
// ---------------------------------------------------------------------------
describe('MessageFormatter — tool call artifact safety net', () => {
  it('should strip tool call text from formatted output', () => {
    const input = 'Hey!' + '\n<|tool_call>call: wait(params: {})<tool_call|>';
    const result = messageFormatter.format(input);
    // The chunks should not contain any tool call artifacts
    for (const chunk of result.chunks) {
      expect(chunk).not.toMatch(/tool_call/);
      expect(chunk).not.toMatch(/call:/);
    }
  });

  it('should return empty chunks for tool-call-only response', () => {
    const input = '<|tool_call>call: save_user_fact(params: {"content":"test"})<tool_call|>';
    const result = messageFormatter.format(input);
    // After sanitization the content is empty
    expect(result.chunks.length).toBeLessThanOrEqual(1);
    if (result.chunks.length === 1) {
      expect(result.chunks[0].trim()).toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Static regex pattern tests (unit-level)
// ---------------------------------------------------------------------------
describe('RAW_TOOL_CALL_PATTERNS — regex coverage', () => {
  const patterns = LocalLLMService.RAW_TOOL_CALL_PATTERNS;

  const shouldMatch = [
    '<|tool_call>anything here<tool_call|>',
    '<|tool_call|>call: foo(params: {})<|/tool_call|>',
    '<tool_call>bar<tool_call>',
    '<|tool_call|>',
  ];

  const shouldNotMatch = [
    'normal text without any markers',
    'I called my friend yesterday',
    'the tool was useful',
  ];

  for (const input of shouldMatch) {
    it('should match: ' + JSON.stringify(input.substring(0, 50)), () => {
      const matched = patterns.some(p => { p.lastIndex = 0; return p.test(input); });
      expect(matched).toBe(true);
    });
  }

  for (const input of shouldNotMatch) {
    it('should NOT match: ' + JSON.stringify(input.substring(0, 50)), () => {
      const matched = patterns.some(p => { p.lastIndex = 0; return p.test(input); });
      expect(matched).toBe(false);
    });
  }
});
