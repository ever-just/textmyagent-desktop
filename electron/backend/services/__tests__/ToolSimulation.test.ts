/**
 * Simulation tests for tool use flows: react_to_message, wait, react+wait,
 * normal response, contact allowlist, and tool enable/disable toggles.
 *
 * These tests mock the Claude API response and verify the full pipeline
 * from incoming message → tool execution → response delivery.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks — use global.__test_* to avoid hoisting issues
// ---------------------------------------------------------------------------

// Settings store shared between mock and tests
const _settingsStore: Record<string, string> = {};
(globalThis as any).__test_settingsStore = _settingsStore;

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
  getSetting: (key: string) => (globalThis as any).__test_settingsStore[key] ?? null,
  setSetting: (key: string, value: string) => { (globalThis as any).__test_settingsStore[key] = value; },
  getSettingInt: (key: string, defaultValue: number) => {
    const raw = (globalThis as any).__test_settingsStore[key];
    if (raw == null) return defaultValue;
    try { return JSON.parse(raw); } catch { return defaultValue; }
  },
  getSettingBool: (key: string, defaultValue: boolean) => {
    const raw = (globalThis as any).__test_settingsStore[key];
    if (raw == null) return defaultValue;
    try { return JSON.parse(raw); } catch { return defaultValue; }
  },
  getSettingFloat: (key: string, defaultValue: number) => {
    const raw = (globalThis as any).__test_settingsStore[key];
    if (raw == null) return defaultValue;
    try { return JSON.parse(raw); } catch { return defaultValue; }
  },
  getSettingValue: (key: string, defaultValue: any) => {
    const raw = (globalThis as any).__test_settingsStore[key];
    if (raw == null) return defaultValue;
    try { return JSON.parse(raw); } catch { return defaultValue; }
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

vi.mock('../ClaudeService', () => ({
  claudeService: {
    isConfigured: vi.fn().mockReturnValue(true),
    refreshClient: vi.fn(),
    generateResponse: vi.fn(),
    setModel: vi.fn(),
    setMaxTokens: vi.fn(),
    setTemperature: vi.fn(),
    syncSettings: vi.fn(),
  },
}));

vi.mock('../MessageFormatter', () => ({
  messageFormatter: {
    format: vi.fn(),
  },
}));

vi.mock('../MemoryService', () => ({
  memoryService: {
    getUserFacts: vi.fn().mockReturnValue([]),
    getLatestSummary: vi.fn().mockReturnValue(null),
    expireOldFacts: vi.fn(),
  },
}));

vi.mock('../PromptBuilder', () => ({
  promptBuilder: {
    buildWithCacheControl: vi.fn().mockReturnValue([
      { type: 'text', text: 'system prompt' },
    ]),
  },
}));

vi.mock('../ToolRegistry', () => ({
  toolRegistry: {
    getAnthropicTools: vi.fn().mockReturnValue([
      { name: 'react_to_message', description: 'Send tapback', input_schema: {} },
      { name: 'wait', description: 'Skip response', input_schema: {} },
    ]),
    executeToolCall: vi.fn(),
    getDefinitions: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('../RateLimiter', () => ({
  rateLimiter: {
    checkLimit: vi.fn().mockReturnValue({ allowed: true }),
    recordRequest: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { AgentService } from '../AgentService';
import { iMessageService } from '../iMessageService';
import { claudeService } from '../ClaudeService';
import { messageFormatter } from '../MessageFormatter';
import { log } from '../../logger';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function createMessage(text: string, overrides = {}) {
  return {
    guid: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    chatGuid: 'iMessage;-;+11234567890',
    handleId: '+11234567890',
    text,
    dateCreated: new Date(),
    isFromMe: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tool Simulation Tests', () => {
  let agent: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear settings store
    for (const key of Object.keys(_settingsStore)) delete _settingsStore[key];
    agent = new AgentService();
    // Mark agent as running so handleIncomingMessage processes
    (agent as any).isRunning = true;

    // Default MessageFormatter mock: pass through single chunk
    vi.mocked(messageFormatter.format).mockImplementation((text: string) => ({
      chunks: [text],
      wasTruncated: false,
      wasSanitized: false,
      originalLength: text.length,
      processedLength: text.length,
    }) as any);
  });

  afterEach(() => {
    agent.stop();
  });

  // =========================================================================
  // Scenario 1: Normal text response (no tools)
  // =========================================================================
  describe('Scenario 1: Normal text response', () => {
    it('should send a text reply when Claude responds with text only', async () => {
      // Simulate: User asks "What time is it?" → Claude responds with text
      vi.mocked(claudeService.generateResponse).mockResolvedValue({
        content: "It's about 2pm!",
        inputTokens: 150,
        outputTokens: 30,
        stopReason: 'end_turn',
        toolsUsed: [],
      } as any);

      const msg = createMessage('What time is it?');
      await (agent as any).handleIncomingMessage(msg);

      // Should have sent the response via iMessage
      expect(iMessageService.sendMessage).toHaveBeenCalledWith(
        'iMessage;-;+11234567890',
        "It's about 2pm!"
      );

      // Should NOT have called wait or react
      const genCall = vi.mocked(claudeService.generateResponse).mock.calls[0];
      expect(genCall[0]).toBe('What time is it?');
    });
  });

  // =========================================================================
  // Scenario 2: Wait tool only (agent chooses silence)
  // =========================================================================
  describe('Scenario 2: Wait tool — agent stays silent', () => {
    it('should NOT send any text when Claude uses wait tool', async () => {
      // Simulate: User says "ok" → Claude calls wait → no text response
      vi.mocked(claudeService.generateResponse).mockResolvedValue({
        content: '',
        inputTokens: 120,
        outputTokens: 40,
        stopReason: 'end_turn',
        toolsUsed: ['wait'],
      } as any);

      const msg = createMessage('ok');
      await (agent as any).handleIncomingMessage(msg);

      // Should NOT have sent any message
      expect(iMessageService.sendMessage).not.toHaveBeenCalled();

      // Should log the wait decision
      expect(log).toHaveBeenCalledWith(
        'info',
        'Agent chose to wait \u2014 no text response sent',
        expect.objectContaining({
          toolsUsed: 'wait',
        })
      );
    });

    it('should handle "thanks" message with wait', async () => {
      vi.mocked(claudeService.generateResponse).mockResolvedValue({
        content: '',
        inputTokens: 130,
        outputTokens: 35,
        stopReason: 'end_turn',
        toolsUsed: ['react_to_message', 'wait'],
      } as any);

      const msg = createMessage('thanks!');
      await (agent as any).handleIncomingMessage(msg);

      // No text response sent
      expect(iMessageService.sendMessage).not.toHaveBeenCalled();

      // Logged with both tools
      expect(log).toHaveBeenCalledWith(
        'info',
        'Agent chose to wait \u2014 no text response sent',
        expect.objectContaining({
          toolsUsed: 'react_to_message, wait',
        })
      );
    });
  });

  // =========================================================================
  // Scenario 3: React tool + text response (good news)
  // =========================================================================
  describe('Scenario 3: React + text response', () => {
    it('should send text when Claude reacts AND responds', async () => {
      // Simulate: User says "I got the job!" → Claude reacts with love + sends congrats
      vi.mocked(claudeService.generateResponse).mockResolvedValue({
        content: 'Congrats!! That is amazing news 🎉',
        inputTokens: 180,
        outputTokens: 55,
        stopReason: 'end_turn',
        toolsUsed: ['react_to_message'],
      } as any);

      const msg = createMessage('I got the job!');
      await (agent as any).handleIncomingMessage(msg);

      // Should have sent the congratulations text
      expect(iMessageService.sendMessage).toHaveBeenCalledWith(
        'iMessage;-;+11234567890',
        'Congrats!! That is amazing news 🎉'
      );
    });
  });

  // =========================================================================
  // Scenario 4: React + wait (acknowledgment — no text needed)
  // =========================================================================
  describe('Scenario 4: React + wait (tapback only)', () => {
    it('should NOT send text when Claude reacts + waits for "got it"', async () => {
      vi.mocked(claudeService.generateResponse).mockResolvedValue({
        content: '',
        inputTokens: 110,
        outputTokens: 45,
        stopReason: 'end_turn',
        toolsUsed: ['react_to_message', 'wait'],
      } as any);

      const msg = createMessage('got it');
      await (agent as any).handleIncomingMessage(msg);

      expect(iMessageService.sendMessage).not.toHaveBeenCalled();
    });

    it('should NOT send text when Claude reacts + waits for "bye"', async () => {
      vi.mocked(claudeService.generateResponse).mockResolvedValue({
        content: '',
        inputTokens: 105,
        outputTokens: 42,
        stopReason: 'end_turn',
        toolsUsed: ['react_to_message', 'wait'],
      } as any);

      const msg = createMessage('bye!');
      await (agent as any).handleIncomingMessage(msg);

      expect(iMessageService.sendMessage).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Scenario 5: Tapback reaction from user — agent should ignore
  // =========================================================================
  describe('Scenario 5: User tapback reaction — agent waits', () => {
    it('should NOT respond to "Liked" tapback text', async () => {
      vi.mocked(claudeService.generateResponse).mockResolvedValue({
        content: '',
        inputTokens: 95,
        outputTokens: 30,
        stopReason: 'end_turn',
        toolsUsed: ['wait'],
      } as any);

      const msg = createMessage('Liked "sounds good"');
      await (agent as any).handleIncomingMessage(msg);

      expect(iMessageService.sendMessage).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Scenario 6: Claude returns null (API error)
  // =========================================================================
  describe('Scenario 6: Claude API failure', () => {
    it('should log error when Claude returns null', async () => {
      vi.mocked(claudeService.generateResponse).mockResolvedValue(null as any);

      const msg = createMessage('Hello?');
      await (agent as any).handleIncomingMessage(msg);

      expect(iMessageService.sendMessage).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        'error',
        'No response generated from Claude'
      );
    });
  });

  // =========================================================================
  // Scenario 7: Multi-chunk response
  // =========================================================================
  describe('Scenario 7: Multi-chunk response', () => {
    it('should send all chunks when response is split', async () => {
      vi.mocked(claudeService.generateResponse).mockResolvedValue({
        content: 'Part 1\n\nPart 2',
        inputTokens: 200,
        outputTokens: 60,
        stopReason: 'end_turn',
        toolsUsed: [],
      } as any);

      vi.mocked(messageFormatter.format).mockReturnValue({
        chunks: ['Part 1', 'Part 2'],
        wasTruncated: false,
        wasSanitized: false,
        originalLength: 14,
        processedLength: 14,
      } as any);

      const msg = createMessage('Tell me a story');
      await (agent as any).handleIncomingMessage(msg);

      expect(iMessageService.sendMessage).toHaveBeenCalledTimes(2);
      expect(iMessageService.sendMessage).toHaveBeenNthCalledWith(1, 'iMessage;-;+11234567890', 'Part 1');
      expect(iMessageService.sendMessage).toHaveBeenNthCalledWith(2, 'iMessage;-;+11234567890', 'Part 2');
    });
  });
});

// ===========================================================================
// Contact Allowlist Tests
// ===========================================================================
describe('Contact Allowlist Simulation', () => {
  let agent: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(_settingsStore)) delete _settingsStore[key];
    agent = new AgentService();
    (agent as any).isRunning = true;

    vi.mocked(messageFormatter.format).mockImplementation((text: string) => ({
      chunks: [text],
      wasTruncated: false,
      wasSanitized: false,
      originalLength: text.length,
      processedLength: text.length,
    }) as any);
  });

  afterEach(() => {
    agent.stop();
  });

  it('should process messages from anyone when replyMode is "everyone"', async () => {
    _settingsStore['agent.replyMode'] = JSON.stringify('everyone');

    vi.mocked(claudeService.generateResponse).mockResolvedValue({
      content: 'Hi there!',
      inputTokens: 100,
      outputTokens: 20,
      stopReason: 'end_turn',
      toolsUsed: [],
    } as any);

    const msg = createMessage('hello', { handleId: '+19999999999' });
    await (agent as any).handleIncomingMessage(msg);

    expect(claudeService.generateResponse).toHaveBeenCalled();
  });

  it('should SKIP messages from contacts NOT in allowlist', async () => {
    _settingsStore['agent.replyMode'] = JSON.stringify('allowlist');
    _settingsStore['agent.allowedContacts'] = JSON.stringify(['+11111111111']);

    const msg = createMessage('hello', { handleId: '+19999999999' });
    await (agent as any).handleIncomingMessage(msg);

    // Claude should NOT have been called
    expect(claudeService.generateResponse).not.toHaveBeenCalled();

    // Should log the skip
    expect(log).toHaveBeenCalledWith(
      'info',
      'Skipping message \u2014 contact not in allowlist',
      expect.objectContaining({ handle: '+19999999999' })
    );
  });

  it('should PROCESS messages from contacts IN the allowlist', async () => {
    _settingsStore['agent.replyMode'] = JSON.stringify('allowlist');
    _settingsStore['agent.allowedContacts'] = JSON.stringify(['+11234567890']);

    vi.mocked(claudeService.generateResponse).mockResolvedValue({
      content: 'Hey!',
      inputTokens: 100,
      outputTokens: 20,
      stopReason: 'end_turn',
      toolsUsed: [],
    } as any);

    const msg = createMessage('hello', {
      handleId: '+11234567890',
      chatGuid: 'iMessage;-;+11234567890',
    });
    await (agent as any).handleIncomingMessage(msg);

    expect(claudeService.generateResponse).toHaveBeenCalled();
  });

  it('should normalize phone numbers for allowlist matching (last 10 digits)', async () => {
    _settingsStore['agent.replyMode'] = JSON.stringify('allowlist');
    // Stored with country code prefix
    _settingsStore['agent.allowedContacts'] = JSON.stringify(['+11234567890']);

    vi.mocked(claudeService.generateResponse).mockResolvedValue({
      content: 'Hey!',
      inputTokens: 100,
      outputTokens: 20,
      stopReason: 'end_turn',
      toolsUsed: [],
    } as any);

    // Incoming with different format but same last 10 digits
    const msg = createMessage('hello', {
      handleId: '1234567890',
      chatGuid: 'iMessage;-;1234567890',
    });
    await (agent as any).handleIncomingMessage(msg);

    // Should match via normalized comparison
    expect(claudeService.generateResponse).toHaveBeenCalled();
  });
});

// ===========================================================================
// Tool Execution Unit Tests (react_to_message & wait)
// ===========================================================================
describe('Tool Execution — react_to_message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(_settingsStore)) delete _settingsStore[key];
  });

  it('should send emoji as text for valid reaction types', async () => {
    const { reactToMessage } = await import('../../tools/reactToMessage');

    const context = { userId: '+11234567890', chatGuid: 'iMessage;-;+11234567890' };

    // Test each reaction type
    const reactions = ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'];
    const emojis = ['\u2764\uFE0F', '\uD83D\uDC4D', '\uD83D\uDC4E', '\uD83D\uDE02', '\u203C\uFE0F', '\u2753'];

    for (let i = 0; i < reactions.length; i++) {
      vi.mocked(iMessageService.sendMessage).mockResolvedValue(true);
      const result = await reactToMessage({ reaction: reactions[i] }, context);

      expect(result).toContain(reactions[i]);
      expect(iMessageService.sendMessage).toHaveBeenCalledWith(
        'iMessage;-;+11234567890',
        expect.any(String)
      );
    }
  });

  it('should throw error for invalid reaction type', async () => {
    const { reactToMessage } = await import('../../tools/reactToMessage');
    const context = { userId: '+11234567890', chatGuid: 'iMessage;-;+11234567890' };

    await expect(
      reactToMessage({ reaction: 'invalid' }, context)
    ).rejects.toThrow('Invalid reaction');
  });

  it('should throw error when sendMessage fails', async () => {
    const { reactToMessage } = await import('../../tools/reactToMessage');
    const context = { userId: '+11234567890', chatGuid: 'iMessage;-;+11234567890' };

    vi.mocked(iMessageService.sendMessage).mockResolvedValue(false);

    await expect(
      reactToMessage({ reaction: 'love' }, context)
    ).rejects.toThrow('Failed to send reaction');
  });
});

describe('Tool Execution — wait', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return waiting message with reason', async () => {
    const { waitTool } = await import('../../tools/waitTool');
    const context = { userId: '+11234567890', chatGuid: 'iMessage;-;+11234567890' };

    const result = await waitTool({ reason: 'user said thanks' }, context);

    expect(result).toContain('Waiting silently');
    expect(result).toContain('user said thanks');
  });

  it('should use default reason when none provided', async () => {
    const { waitTool } = await import('../../tools/waitTool');
    const context = { userId: '+11234567890', chatGuid: 'iMessage;-;+11234567890' };

    const result = await waitTool({}, context);

    expect(result).toContain('No response needed');
  });
});


// ===========================================================================
// End-to-end decision matrix simulation
// ===========================================================================
describe('Decision Matrix — Full Message Flow Simulations', () => {
  let agent: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(_settingsStore)) delete _settingsStore[key];
    agent = new AgentService();
    (agent as any).isRunning = true;

    vi.mocked(messageFormatter.format).mockImplementation((text: string) => ({
      chunks: [text],
      wasTruncated: false,
      wasSanitized: false,
      originalLength: text.length,
      processedLength: text.length,
    }) as any);
  });

  afterEach(() => {
    agent.stop();
  });

  const scenarios = [
    {
      name: 'Question → RESPOND with text',
      userMessage: "What's your email?",
      claudeResponse: { content: 'My email is hello@example.com', toolsUsed: [], stopReason: 'end_turn' },
      expectSend: true,
      expectText: 'My email is hello@example.com',
    },
    {
      name: 'Acknowledgment "ok" → react + wait (no text)',
      userMessage: 'ok',
      claudeResponse: { content: '', toolsUsed: ['react_to_message', 'wait'], stopReason: 'end_turn' },
      expectSend: false,
    },
    {
      name: 'Gratitude "thanks!" → react + wait (no text)',
      userMessage: 'thanks!',
      claudeResponse: { content: '', toolsUsed: ['react_to_message', 'wait'], stopReason: 'end_turn' },
      expectSend: false,
    },
    {
      name: 'Good news → react + RESPOND',
      userMessage: 'I passed my exam!',
      claudeResponse: { content: 'That is incredible!! So proud of you', toolsUsed: ['react_to_message'], stopReason: 'end_turn' },
      expectSend: true,
      expectText: 'That is incredible!! So proud of you',
    },
    {
      name: 'Funny message → react + wait',
      userMessage: 'lol',
      claudeResponse: { content: '', toolsUsed: ['react_to_message', 'wait'], stopReason: 'end_turn' },
      expectSend: false,
    },
    {
      name: 'Goodbye → react + wait',
      userMessage: 'ttyl',
      claudeResponse: { content: '', toolsUsed: ['react_to_message', 'wait'], stopReason: 'end_turn' },
      expectSend: false,
    },
    {
      name: 'User tapback → wait only',
      userMessage: 'Loved "sounds good"',
      claudeResponse: { content: '', toolsUsed: ['wait'], stopReason: 'end_turn' },
      expectSend: false,
    },
    {
      name: 'Request for info → RESPOND',
      userMessage: 'Tell me about quantum computing',
      claudeResponse: { content: 'Quantum computing uses qubits...', toolsUsed: [], stopReason: 'end_turn' },
      expectSend: true,
      expectText: 'Quantum computing uses qubits...',
    },
    {
      name: '"Can you..." → RESPOND',
      userMessage: 'Can you help me with my homework?',
      claudeResponse: { content: 'Of course! What subject?', toolsUsed: [], stopReason: 'end_turn' },
      expectSend: true,
      expectText: 'Of course! What subject?',
    },
    {
      name: 'Simple "k" → react + wait',
      userMessage: 'k',
      claudeResponse: { content: '', toolsUsed: ['react_to_message', 'wait'], stopReason: 'end_turn' },
      expectSend: false,
    },
  ];

  for (const scenario of scenarios) {
    it(`${scenario.name}`, async () => {
      vi.mocked(claudeService.generateResponse).mockResolvedValue({
        content: scenario.claudeResponse.content,
        inputTokens: 100,
        outputTokens: 40,
        stopReason: scenario.claudeResponse.stopReason,
        toolsUsed: scenario.claudeResponse.toolsUsed,
      } as any);

      const msg = createMessage(scenario.userMessage);
      await (agent as any).handleIncomingMessage(msg);

      if (scenario.expectSend) {
        expect(iMessageService.sendMessage).toHaveBeenCalledWith(
          expect.any(String),
          scenario.expectText
        );
      } else {
        expect(iMessageService.sendMessage).not.toHaveBeenCalled();
      }
    });
  }
});
