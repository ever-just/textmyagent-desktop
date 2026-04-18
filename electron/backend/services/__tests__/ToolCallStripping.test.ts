/**
 * Tests for tool-call artifact sanitization (Gemma 4 workaround).
 *
 * Covers:
 *   1. LocalLLMService.sanitizeToolCallArtifacts — regex detection and
 *      text cleanup. Sanitize-only, no execution (see docs/RELIABILITY_IMPLEMENTATION.md P0.3).
 *   2. MessageFormatter sanitize layer — safety-net stripping of tool-call
 *      artifacts that slip through.
 *   3. Static regex coverage + false-positive guards.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

// ---------------------------------------------------------------------------
// 1. sanitizeToolCallArtifacts — unit tests
// ---------------------------------------------------------------------------
describe('LocalLLMService.sanitizeToolCallArtifacts', () => {
  let service: LocalLLMService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LocalLLMService();
  });

  it('returns empty input unchanged', () => {
    expect(service.sanitizeToolCallArtifacts('')).toBe('');
  });

  it('returns clean text unchanged', () => {
    const text = 'Hello! How are you?';
    expect(service.sanitizeToolCallArtifacts(text)).toBe(text);
  });

  it('never calls toolRegistry.executeToolCall (sanitize-only)', () => {
    const raw =
      '<|tool_call>call: save_user_fact(params: {"content":"likes pizza"})<tool_call|>';
    service.sanitizeToolCallArtifacts(raw);
    expect(toolRegistry.executeToolCall).not.toHaveBeenCalled();
  });

  // --- Pattern 1: Delimited tool call -------------------------------------
  it('strips delimited <|tool_call>...<tool_call|> block', () => {
    const raw =
      '<|tool_call>call: save_user_fact(params: {"content":"likes pizza","type":"preference"})<tool_call|>';
    expect(service.sanitizeToolCallArtifacts(raw)).toBe('');
  });

  it('strips <|tool_call|>...<|/tool_call|> pipe variant', () => {
    const raw =
      '<|tool_call|>call: wait(params: {"reason":"no reply needed"})<|/tool_call|>';
    expect(service.sanitizeToolCallArtifacts(raw)).toBe('');
  });

  it('preserves normal text and strips only the delimited tool call', () => {
    const raw =
      'That sounds fun!\n<|tool_call>call: save_user_fact(params: {"content":"enjoys hiking"})<tool_call|>';
    expect(service.sanitizeToolCallArtifacts(raw)).toBe('That sounds fun!');
  });

  // --- Pattern 2: Gemma fenced tool_code blocks ---------------------------
  it('strips ```tool_code ... ``` fenced blocks (with set_reminder)', () => {
    const raw =
      'Sure, will do!\n```tool_code\nset_reminder(message="Call mom", due_at="2026-04-18T15:00:00Z")\n```';
    expect(service.sanitizeToolCallArtifacts(raw)).toBe('Sure, will do!');
  });

  // --- Pattern 3: Bare whole-line tool-name calls -------------------------
  it('strips bare "wait(reason: \\"goodbye\\")" on its own line (yesterday regression)', () => {
    const raw = 'take care!\nwait(reason: "goodbye")';
    expect(service.sanitizeToolCallArtifacts(raw)).toBe('take care!');
  });

  it('strips bare "react_to_message(params: {...})" even after removal (regression guard)', () => {
    const raw = 'sure!\nreact_to_message(params: {reaction: "like"})';
    expect(service.sanitizeToolCallArtifacts(raw)).toBe('sure!');
  });

  it('strips bare "save_user_fact(content=..., type=...)" kwarg style', () => {
    const raw = 'cool\nsave_user_fact(content="Weldon", type="personal")';
    expect(service.sanitizeToolCallArtifacts(raw)).toBe('cool');
  });

  it('strips bare "set_reminder(message=..., due_at=...)" line', () => {
    const raw = 'okay\nset_reminder(message="Call mom", due_at="2026-04-18T15:00:00Z")';
    expect(service.sanitizeToolCallArtifacts(raw)).toBe('okay');
  });

  it('strips multiple bare tool calls on separate lines', () => {
    const raw = [
      'Nice to meet you, Weldon!',
      'save_user_fact(content="Name is Weldon", type="personal")',
      'wait(reason: "handled")',
    ].join('\n');
    expect(service.sanitizeToolCallArtifacts(raw)).toBe('Nice to meet you, Weldon!');
  });

  // --- False-positive guards: tool-name words in prose MUST NOT be stripped
  it('does NOT strip "wait" used as a verb inside prose', () => {
    const text = 'I had to wait about a minute for the bus';
    expect(service.sanitizeToolCallArtifacts(text)).toBe(text);
  });

  it('does NOT strip "search_history" referenced in natural language', () => {
    const text = 'please search_history for me when you get a sec';
    expect(service.sanitizeToolCallArtifacts(text)).toBe(text);
  });

  it('does NOT strip a sentence that only contains the word "wait"', () => {
    const text = 'wait really?';
    expect(service.sanitizeToolCallArtifacts(text)).toBe(text);
  });

  it('does NOT strip "set_reminder" mentioned without parentheses', () => {
    const text = 'can you set_reminder for 3pm tomorrow';
    expect(service.sanitizeToolCallArtifacts(text)).toBe(text);
  });

  // --- Stray markers ------------------------------------------------------
  it('strips stray tool_call markers without content', () => {
    const raw = 'Great talking to you! <|tool_call|>';
    expect(service.sanitizeToolCallArtifacts(raw)).toBe('Great talking to you!');
  });

  // --- Generic special-token leak ----------------------------------------
  it('strips leaked <|eos|>-style special tokens', () => {
    const marker = ['<', '|', 'eos', '|', '>'].join('');
    const raw = 'Hello there ' + marker;
    expect(service.sanitizeToolCallArtifacts(raw)).toBe('Hello there');
  });

  // --- Token leak inside delimited block ---------------------------------
  it('strips the delimited block cleanly even when <|"|"> appears inside', () => {
    const raw =
      '<|tool_call>call: save_user_fact(params: {"content":<|"|>pizza<|"|>})<tool_call|>';
    expect(service.sanitizeToolCallArtifacts(raw)).toBe('');
  });

  // --- Malformed JSON inside delimited block -----------------------------
  it('strips the delimited block even when JSON params are malformed', () => {
    const raw = '<|tool_call>call: save_user_fact(params: {INVALID JSON})<tool_call|>';
    expect(service.sanitizeToolCallArtifacts(raw)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 2. MessageFormatter sanitize safety net
// ---------------------------------------------------------------------------
describe('MessageFormatter — tool call artifact safety net', () => {
  it('strips tool-call text from formatted output', () => {
    const input = 'Hey!\n<|tool_call>call: wait(params: {})<tool_call|>';
    const result = messageFormatter.format(input);
    for (const chunk of result.chunks) {
      expect(chunk).not.toMatch(/tool_call/);
      expect(chunk).not.toMatch(/call:/);
    }
  });

  it('strips bare tool-call lines via MessageFormatter (yesterday regression)', () => {
    const input = 'take care!\nwait(reason: "goodbye")';
    const result = messageFormatter.format(input);
    for (const chunk of result.chunks) {
      expect(chunk).not.toMatch(/wait\s*\(/);
    }
  });

  it('returns empty chunk for a tool-call-only response', () => {
    const input = '<|tool_call>call: save_user_fact(params: {"content":"test"})<tool_call|>';
    const result = messageFormatter.format(input);
    expect(result.chunks.length).toBeLessThanOrEqual(1);
    if (result.chunks.length === 1) {
      expect(result.chunks[0].trim()).toBe('');
    }
  });

  it('leaves prose containing tool-name words unchanged', () => {
    const input = 'I had to wait about a minute';
    const result = messageFormatter.format(input);
    expect(result.chunks[0]).toBe('I had to wait about a minute');
  });
});

// ---------------------------------------------------------------------------
// 3. Static regex coverage
// ---------------------------------------------------------------------------
describe('RAW_TOOL_CALL_PATTERNS — regex coverage', () => {
  const patterns = LocalLLMService.RAW_TOOL_CALL_PATTERNS;

  const shouldMatch = [
    '<|tool_call>anything here<tool_call|>',
    '<|tool_call|>call: foo(params: {})<|/tool_call|>',
    '<tool_call>bar<tool_call>',
    '<|tool_call|>',
    'wait(reason: "ok")',
    'react_to_message(params: {reaction: "like"})',
    'save_user_fact(content="Weldon", type="personal")',
    'set_reminder(message="x", due_at="2026-01-01T00:00:00Z")',
    '```tool_code\nset_reminder(message="x")\n```',
  ];

  const shouldNotMatch = [
    'normal text without any markers',
    'I called my friend yesterday',
    'the tool was useful',
    'I had to wait about a minute',
    'please search_history for me',
    'let me set_reminder tomorrow',
  ];

  for (const input of shouldMatch) {
    it('matches: ' + JSON.stringify(input.substring(0, 50)), () => {
      const matched = patterns.some((p) => {
        p.lastIndex = 0;
        return p.test(input);
      });
      expect(matched).toBe(true);
    });
  }

  for (const input of shouldNotMatch) {
    it('does NOT match: ' + JSON.stringify(input.substring(0, 50)), () => {
      const matched = patterns.some((p) => {
        p.lastIndex = 0;
        return p.test(input);
      });
      expect(matched).toBe(false);
    });
  }
});
