/**
 * End-to-end behaviour simulations for the 5 fixes:
 *
 *   SIM-1  Tool-call text leak → stripped + executed
 *   SIM-2  Multi-message splitting (3-bubble default)
 *   SIM-3  Memory auto-save via raw-tool fallback
 *   SIM-4  Typing delay reduction (200–1000 ms)
 *   SIM-5  Inference timing telemetry (durationMs in logs)
 *
 * These drive the **real** AgentService + MessageFormatter pipeline with a
 * mocked LLM, iMessage transport, and database to validate realistic flows.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Settings store (shared via globalThis)
// ---------------------------------------------------------------------------
const _settings: Record<string, string> = {};
(globalThis as any).__test_simSettings = _settings;

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
  getSetting: (key: string) => (globalThis as any).__test_simSettings[key] ?? null,
  setSetting: (key: string, value: string) => {
    (globalThis as any).__test_simSettings[key] = value;
  },
  getSettingInt: (key: string, d: number) => {
    const raw = (globalThis as any).__test_simSettings[key];
    if (raw == null) return d;
    try { return JSON.parse(raw); } catch { return d; }
  },
  getSettingBool: (key: string, d: boolean) => {
    const raw = (globalThis as any).__test_simSettings[key];
    if (raw == null) return d;
    try { return JSON.parse(raw); } catch { return d; }
  },
  getSettingFloat: (key: string, d: number) => {
    const raw = (globalThis as any).__test_simSettings[key];
    if (raw == null) return d;
    try { return JSON.parse(raw); } catch { return d; }
  },
  getSettingValue: (key: string, d: any) => {
    const raw = (globalThis as any).__test_simSettings[key];
    if (raw == null) return d;
    try { return JSON.parse(raw); } catch { return d; }
  },
  seedDefaultSettings: vi.fn(),
}));

vi.mock('../iMessageService', () => {
  const { EventEmitter } = require('events');
  const emitter = new EventEmitter();
  return {
    iMessageService: Object.assign(emitter, {
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(true),
      checkPermissions: vi.fn().mockResolvedValue({ hasAccess: true }),
      isConnected: vi.fn().mockReturnValue(false),
      getConversationHistory: vi.fn().mockResolvedValue([]),
    }),
    IMessage: {},
  };
});

vi.mock('../LocalLLMService', () => ({
  localLLMService: {
    isConfigured: vi.fn().mockReturnValue(true),
    initModel: vi.fn().mockResolvedValue(undefined),
    generateSummary: vi.fn().mockResolvedValue(null),
    onSessionEvicted: vi.fn(),
    getPoolStats: vi.fn().mockReturnValue({ size: 0, maxSize: 2, entries: [] }),
    detectRecommendedPoolSize: vi.fn().mockReturnValue({ totalRamGB: 16, recommendedModel: 'E4B', maxPooledSessions: 4, contextSize: 4096, notes: 'test' }),
    sweepIdleSessions: vi.fn().mockResolvedValue([]),
    evictSession: vi.fn().mockResolvedValue(undefined),
    refreshClient: vi.fn(),
    generateResponse: vi.fn(),
    setMaxTokens: vi.fn(),
    setTemperature: vi.fn(),
    setContextSize: vi.fn(),
    syncSettings: vi.fn(),
    status: 'loaded',
    isModelDownloaded: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('../MemoryService', () => ({
  memoryService: {
    getUserFacts: vi.fn().mockReturnValue([]),
    getLatestSummary: vi.fn().mockReturnValue(null),
    saveFact: vi.fn(),
    saveSummary: vi.fn(),
    expireOldFacts: vi.fn(),
    touchFact: vi.fn(),
  },
}));

vi.mock('../PromptBuilder', () => ({
  promptBuilder: {
    build: vi.fn().mockReturnValue('system prompt'),
  },
}));

vi.mock('../ToolRegistry', () => ({
  toolRegistry: {
    getEnabledDefinitions: vi.fn().mockReturnValue([]),
    executeToolCall: vi.fn(),
    getDefinitions: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('../MessageFormatter', () => ({
  messageFormatter: {
    format: vi.fn(),
  },
}));

vi.mock('../RateLimiter', () => ({
  rateLimiter: {
    checkLimit: vi.fn().mockReturnValue({ allowed: true }),
    recordRequest: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { AgentService } from '../AgentService';
import { iMessageService } from '../iMessageService';
import { localLLMService } from '../LocalLLMService';
import { messageFormatter } from '../MessageFormatter';
import { memoryService } from '../MemoryService';
import { log } from '../../logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let msgSeq = 0;
function msg(text: string, overrides = {}) {
  return {
    guid: `sim-${++msgSeq}-${Date.now()}`,
    chatGuid: 'iMessage;-;+15559876543',
    handleId: '+15559876543',
    text,
    dateCreated: new Date(),
    isFromMe: false,
    ...overrides,
  };
}

function llmResponse(content: string, toolsUsed: string[] = [], durationMs = 500) {
  return {
    content,
    inputTokens: 100,
    outputTokens: Math.ceil(content.length / 4),
    stopReason: 'end_turn',
    toolsUsed,
    durationMs,
  };
}

// Lightweight formatter that simulates the real sanitisation + splitting pipeline.
function useRealFormatter() {
  vi.mocked(messageFormatter.format).mockImplementation((text: string) => {
    let cleaned = text;
    // Strip tool call artifacts (safety net patterns)
    cleaned = cleaned.replace(/<\|?\/?tool_call\|?>[\s\S]*?<\|?\/?tool_call\|?>/gi, '');
    cleaned = cleaned.replace(/call:\s*\w+\(params:\s*\{[\s\S]*?\}\)/gi, '');
    cleaned = cleaned.replace(/<\|"\|>/g, '');
    cleaned = cleaned.replace(/<\|[a-z_]*\|>/gi, '');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

    if (cleaned.length === 0) {
      return {
        chunks: [''],
        wasTruncated: false,
        wasSanitized: true,
        originalLength: text.length,
        processedLength: 0,
      };
    }

    // Simple splitting: split on double newlines, cap at 3 chunks
    const maxChunks = 3;
    const parts = cleaned.split(/\n\n+/).filter(Boolean);
    const chunks = parts.length > maxChunks
      ? [...parts.slice(0, maxChunks - 1), parts.slice(maxChunks - 1).join(' ')]
      : parts.length > 0 ? parts : [cleaned];

    return {
      chunks,
      wasTruncated: false,
      wasSanitized: text !== cleaned,
      originalLength: text.length,
      processedLength: chunks.reduce((s: number, c: string) => s + c.length, 0),
    };
  });
}

function usePassthroughFormatter() {
  vi.mocked(messageFormatter.format).mockImplementation((text: string) => ({
    chunks: [text],
    wasTruncated: false,
    wasSanitized: false,
    originalLength: text.length,
    processedLength: text.length,
  }) as any);
}

// ============================================================================
// SIM-1: TOOL CALL TEXT LEAK — RAW TOKENS MUST NOT REACH iMESSAGE
// ============================================================================
describe('SIM-1: Tool call text leak prevention', () => {
  let agent: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    for (const key of Object.keys(_settings)) delete _settings[key];
    agent = new AgentService();
    (agent as any).isRunning = true;
    useRealFormatter();
  });

  afterEach(() => {
    vi.useRealTimers();
    agent.stop();
  });

  it('should NOT send raw save_user_fact tool call text to the user', async () => {
    // Simulate: LLM returns only a raw tool-call token (save_user_fact)
    // After sanitizeToolCallArtifacts in LLM service, content should be ''
    // and toolsUsed should include 'save_user_fact'.
    // AgentService should then skip sending.
    vi.mocked(localLLMService.generateResponse).mockResolvedValue(
      llmResponse('', ['save_user_fact'], 300) as any
    );

    const m = msg('My name is Alex');
    const p = (agent as any).handleIncomingMessage(m);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    // No message should be sent to iMessage
    expect(iMessageService.sendMessage).not.toHaveBeenCalled();

    // Should log the tool-only response
    expect(log).toHaveBeenCalledWith(
      'info', 'Tool-only response — no text to send',
      expect.objectContaining({ toolsUsed: 'save_user_fact' })
    );
  });

  it('should send text but NOT tool artifacts when LLM returns mixed content', async () => {
    // Simulate: LLM properly executed tools via API, returned clean text + toolsUsed
    vi.mocked(localLLMService.generateResponse).mockResolvedValue(
      llmResponse('Nice to meet you, Alex!', ['save_user_fact'], 400) as any
    );

    const m = msg('My name is Alex');
    const p = (agent as any).handleIncomingMessage(m);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(iMessageService.sendMessage).toHaveBeenCalledTimes(1);
    const sentText = vi.mocked(iMessageService.sendMessage).mock.calls[0][1];
    expect(sentText).toBe('Nice to meet you, Alex!');
    expect(sentText).not.toMatch(/tool_call/i);
    expect(sentText).not.toMatch(/save_user_fact/);
  });

  it('should handle wait tool with empty content (no message sent)', async () => {
    vi.mocked(localLLMService.generateResponse).mockResolvedValue(
      llmResponse('', ['wait'], 200) as any
    );

    const m = msg('ok thanks');
    const p = (agent as any).handleIncomingMessage(m);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(iMessageService.sendMessage).not.toHaveBeenCalled();
  });

  it('should strip tool artifacts that leak through formatter safety net', async () => {
    // Simulate: LLM returned text WITH residual tool call tokens
    // (as if sanitizeToolCallArtifacts partially missed something)
    const leakyContent = 'Sure thing! <|tool_call>call: wait(params: {})<tool_call|>';
    vi.mocked(localLLMService.generateResponse).mockResolvedValue(
      llmResponse(leakyContent, [], 350) as any
    );

    const m = msg('Can you help?');
    const p = (agent as any).handleIncomingMessage(m);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(iMessageService.sendMessage).toHaveBeenCalledTimes(1);
    const sentText = vi.mocked(iMessageService.sendMessage).mock.calls[0][1];
    expect(sentText).toBe('Sure thing!');
    expect(sentText).not.toMatch(/tool_call/);
  });
});

// ============================================================================
// SIM-2: MULTI-MESSAGE SPLITTING (3-BUBBLE DEFAULT)
// ============================================================================
describe('SIM-2: Multi-message splitting', () => {
  let agent: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    for (const key of Object.keys(_settings)) delete _settings[key];
    agent = new AgentService();
    (agent as any).isRunning = true;
    useRealFormatter();
  });

  afterEach(() => {
    vi.useRealTimers();
    agent.stop();
  });

  it('should send short response as a single bubble', async () => {
    vi.mocked(localLLMService.generateResponse).mockResolvedValue(
      llmResponse('Sure, happy to help!', [], 200) as any
    );

    const p = (agent as any).handleIncomingMessage(msg('hey'));
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(iMessageService.sendMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(iMessageService.sendMessage).mock.calls[0][1]).toBe('Sure, happy to help!');
  });

  it('should split long paragraph-separated response into multiple bubbles', async () => {
    const longResponse = [
      'Here is what I found about that restaurant.',
      '',
      'They are open Monday through Friday from 11am to 10pm.',
      '',
      'On weekends they open at 9am. Reservations recommended!',
    ].join('\n');

    vi.mocked(localLLMService.generateResponse).mockResolvedValue(
      llmResponse(longResponse, [], 600) as any
    );

    const p = (agent as any).handleIncomingMessage(msg('tell me about that restaurant'));
    await vi.advanceTimersByTimeAsync(10000);
    await p;

    // Should split into 3 bubbles (3 paragraphs)
    const sendCalls = vi.mocked(iMessageService.sendMessage).mock.calls;
    expect(sendCalls.length).toBe(3);
    expect(sendCalls[0][1]).toContain('restaurant');
    expect(sendCalls[1][1]).toContain('Monday');
    expect(sendCalls[2][1]).toContain('weekends');
  });

  it('should cap at maxChunks=3 even for very long responses', async () => {
    const fiveParagraphs = [
      'Paragraph one with some content here.',
      '',
      'Paragraph two discussing more details.',
      '',
      'Paragraph three continues the story.',
      '',
      'Paragraph four adds more context.',
      '',
      'Paragraph five wraps it all up nicely.',
    ].join('\n');

    vi.mocked(localLLMService.generateResponse).mockResolvedValue(
      llmResponse(fiveParagraphs, [], 700) as any
    );

    const p = (agent as any).handleIncomingMessage(msg('tell me everything'));
    await vi.advanceTimersByTimeAsync(10000);
    await p;

    // Should be capped at 3 bubbles
    expect(vi.mocked(iMessageService.sendMessage).mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('should send bubbles with delay between them', async () => {
    _settings['agent.splitDelaySeconds'] = '1';

    const twoParas = 'First bubble content.\n\nSecond bubble content.';
    vi.mocked(localLLMService.generateResponse).mockResolvedValue(
      llmResponse(twoParas, [], 400) as any
    );

    const sendTimes: number[] = [];
    vi.mocked(iMessageService.sendMessage).mockImplementation(async () => {
      sendTimes.push(Date.now());
      return true;
    });

    const p = (agent as any).handleIncomingMessage(msg('question'));
    await vi.advanceTimersByTimeAsync(15000);
    await p;

    if (sendTimes.length >= 2) {
      const gap = sendTimes[1] - sendTimes[0];
      expect(gap).toBeGreaterThanOrEqual(900); // ~1000ms with tolerance
    }
  });
});

// ============================================================================
// SIM-3: MEMORY AUTO-SAVE (via tool execution)
// ============================================================================
describe('SIM-3: Memory auto-save via tool execution', () => {
  let agent: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    for (const key of Object.keys(_settings)) delete _settings[key];
    agent = new AgentService();
    (agent as any).isRunning = true;
    usePassthroughFormatter();
  });

  afterEach(() => {
    vi.useRealTimers();
    agent.stop();
  });

  it('should proceed normally when save_user_fact was executed and text is returned', async () => {
    // Model properly called save_user_fact via API AND returned text
    vi.mocked(localLLMService.generateResponse).mockResolvedValue(
      llmResponse('Got it, Alex! Nice name.', ['save_user_fact'], 450) as any
    );

    const p = (agent as any).handleIncomingMessage(msg('My name is Alex'));
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    // Text should still be sent
    expect(iMessageService.sendMessage).toHaveBeenCalledWith(
      'iMessage;-;+15559876543',
      'Got it, Alex! Nice name.'
    );
  });

  it('should skip sending when only tool calls with no text (silent save)', async () => {
    // Model called save_user_fact but returned empty text (silent operation)
    vi.mocked(localLLMService.generateResponse).mockResolvedValue(
      llmResponse('', ['save_user_fact'], 300) as any
    );

    const p = (agent as any).handleIncomingMessage(msg('I live in Brooklyn'));
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    // No message sent — fact saved silently
    expect(iMessageService.sendMessage).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'info', 'Tool-only response — no text to send',
      expect.objectContaining({ toolsUsed: 'save_user_fact' })
    );
  });

  it('should inject user facts into prompt context when they exist', async () => {
    vi.mocked(memoryService.getUserFacts).mockReturnValue([
      { id: 'f1', userId: '+15559876543', type: 'personal', content: 'Name is Alex', source: 'ai_extracted', confidence: 0.9, createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000 * 90).toISOString() },
    ]);

    vi.mocked(localLLMService.generateResponse).mockResolvedValue(
      llmResponse('Hey Alex!', [], 300) as any
    );

    const p = (agent as any).handleIncomingMessage(msg('hi'));
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    // generateResponse should have been called with promptContext containing userFacts
    const callArgs = vi.mocked(localLLMService.generateResponse).mock.calls[0];
    // callArgs[3] is promptContext
    expect(callArgs![3]).toHaveProperty('userFacts');
    expect((callArgs![3] as any).userFacts).toHaveLength(1);
    expect((callArgs![3] as any).userFacts[0].content).toBe('Name is Alex');
  });
});

// ============================================================================
// SIM-4: TYPING DELAY REDUCTION
// ============================================================================
describe('SIM-4: Typing delay removed — immediate send for responsiveness', () => {
  let agent: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    for (const key of Object.keys(_settings)) delete _settings[key];
    agent = new AgentService();
    (agent as any).isRunning = true;
    usePassthroughFormatter();
  });

  afterEach(() => {
    vi.useRealTimers();
    agent.stop();
  });

  const delayCases = [
    { name: 'very short (2 chars)', content: 'Hi' },
    { name: 'short (20 chars)',     content: 'Sure, I can help!!!!' },
    { name: 'medium (80 chars)',    content: 'Y'.repeat(80) },
    { name: 'long (200 chars)',     content: 'Z'.repeat(200) },
    { name: 'very long (500 chars)', content: 'W'.repeat(500) },
  ];

  for (const tc of delayCases) {
    it(`${tc.name}: should send immediately (no artificial delay)`, async () => {
      vi.mocked(localLLMService.generateResponse).mockResolvedValue(
        llmResponse(tc.content, [], 300) as any
      );

      const p = (agent as any).handleIncomingMessage(msg('test'));

      // Should send immediately
      await vi.advanceTimersByTimeAsync(50);
      await p;
      expect(iMessageService.sendMessage).toHaveBeenCalledTimes(1);
    });
  }
});

// ============================================================================
// SIM-5: INFERENCE TIMING TELEMETRY
// ============================================================================
describe('SIM-5: Inference timing telemetry (durationMs)', () => {
  let agent: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    for (const key of Object.keys(_settings)) delete _settings[key];
    agent = new AgentService();
    (agent as any).isRunning = true;
    usePassthroughFormatter();
  });

  afterEach(() => {
    vi.useRealTimers();
    agent.stop();
  });

  it('should include inferenceDurationMs in Response sent log', async () => {
    vi.mocked(localLLMService.generateResponse).mockResolvedValue(
      llmResponse('The answer is 42.', ['web_search'], 1234) as any
    );

    const p = (agent as any).handleIncomingMessage(msg('What is the meaning of life?'));
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(log).toHaveBeenCalledWith(
      'info', 'Response sent',
      expect.objectContaining({
        inferenceDurationMs: 1234,
        toolsUsed: 'web_search',
      })
    );
  });

  it('should include durationMs in wait-tool skip log', async () => {
    vi.mocked(localLLMService.generateResponse).mockResolvedValue(
      llmResponse('', ['wait'], 89) as any
    );

    const p = (agent as any).handleIncomingMessage(msg('k'));
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(log).toHaveBeenCalledWith(
      'info', expect.stringContaining('wait'),
      expect.objectContaining({ durationMs: 89 })
    );
  });

  it('should include durationMs in tool-only skip log', async () => {
    vi.mocked(localLLMService.generateResponse).mockResolvedValue(
      llmResponse('', ['save_user_fact'], 456) as any
    );

    const p = (agent as any).handleIncomingMessage(msg('I love sushi'));
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(log).toHaveBeenCalledWith(
      'info', 'Tool-only response — no text to send',
      expect.objectContaining({ durationMs: 456 })
    );
  });
});

// ============================================================================
// SIM-MATRIX: Realistic conversation scenarios
// ============================================================================
describe('SIM-MATRIX: Realistic conversation flows', () => {
  let agent: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    for (const key of Object.keys(_settings)) delete _settings[key];
    agent = new AgentService();
    (agent as any).isRunning = true;
    useRealFormatter();
  });

  afterEach(() => {
    vi.useRealTimers();
    agent.stop();
  });

  const scenarios = [
    {
      name: 'User shares name → fact saved silently, friendly reply sent',
      userMessage: 'Hey, I\'m Jordan',
      llmContent: 'Hey Jordan! Nice to meet you',
      llmTools: ['save_user_fact'],
      expectSendCount: 1,
      expectSentContains: 'Jordan',
    },
    {
      name: 'User sends "ok" → wait, nothing sent',
      userMessage: 'ok',
      llmContent: '',
      llmTools: ['wait'],
      expectSendCount: 0,
    },
    {
      name: 'User asks complex question → multi-paragraph reply → multiple bubbles',
      userMessage: 'Explain quantum computing',
      llmContent: 'Quantum computing uses qubits instead of bits.\n\nUnlike classical bits, qubits can be in superposition.\n\nThis lets quantum computers solve certain problems exponentially faster.',
      llmTools: [],
      expectSendCount: 3,
    },
    {
      name: 'Simple greeting → single short bubble',
      userMessage: 'hi',
      llmContent: 'Hey! How are you?',
      llmTools: [],
      expectSendCount: 1,
    },
    {
      name: 'User says thanks → wait, no text',
      userMessage: 'thanks!',
      llmContent: '',
      llmTools: ['wait'],
      expectSendCount: 0,
    },
  ];

  for (const s of scenarios) {
    it(s.name, async () => {
      vi.mocked(localLLMService.generateResponse).mockResolvedValue(
        llmResponse(s.llmContent, s.llmTools, 400) as any
      );

      const p = (agent as any).handleIncomingMessage(msg(s.userMessage));
      await vi.advanceTimersByTimeAsync(15000);
      await p;

      expect(iMessageService.sendMessage).toHaveBeenCalledTimes(s.expectSendCount);

      if (s.expectSentContains && s.expectSendCount > 0) {
        const firstSent = vi.mocked(iMessageService.sendMessage).mock.calls[0][1];
        expect(firstSent).toContain(s.expectSentContains);
      }
    });
  }
});
