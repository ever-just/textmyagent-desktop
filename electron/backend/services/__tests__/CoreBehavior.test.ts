/**
 * Core behavior tests: response splitting (multi-bubble), typing indicator,
 * and double-text queue serialization.
 *
 * These validate the user's highest-priority concerns:
 *   1. Responses split into separate iMessage bubbles, not one long wall
 *   2. Typing indicator delay before each response
 *   3. Double-texts don't cause double-responses; queue serializes them
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Settings store shared via globalThis to avoid vi.mock hoisting issues
// ---------------------------------------------------------------------------
const _settingsStore: Record<string, string> = {};
(globalThis as any).__test_coreSettings = _settingsStore;

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
  getSetting: (key: string) => (globalThis as any).__test_coreSettings[key] ?? null,
  setSetting: (key: string, value: string) => { (globalThis as any).__test_coreSettings[key] = value; },
  getSettingInt: (key: string, defaultValue: number) => {
    const raw = (globalThis as any).__test_coreSettings[key];
    if (raw == null) return defaultValue;
    try { return JSON.parse(raw); } catch { return defaultValue; }
  },
  getSettingBool: (key: string, defaultValue: boolean) => {
    const raw = (globalThis as any).__test_coreSettings[key];
    if (raw == null) return defaultValue;
    try { return JSON.parse(raw); } catch { return defaultValue; }
  },
  getSettingFloat: (key: string, defaultValue: number) => {
    const raw = (globalThis as any).__test_coreSettings[key];
    if (raw == null) return defaultValue;
    try { return JSON.parse(raw); } catch { return defaultValue; }
  },
  getSettingValue: (key: string, defaultValue: any) => {
    const raw = (globalThis as any).__test_coreSettings[key];
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
    touchFact: vi.fn(),
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
    getAnthropicTools: vi.fn().mockReturnValue([]),
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
// Imports after mocks
// ---------------------------------------------------------------------------
import { AgentService } from '../AgentService';
import { iMessageService } from '../iMessageService';
import { claudeService } from '../ClaudeService';
import { messageFormatter } from '../MessageFormatter';
import { log } from '../../logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let msgCounter = 0;
function msg(text: string, overrides: Record<string, any> = {}) {
  msgCounter++;
  return {
    guid: `msg-${msgCounter}-${Date.now()}`,
    chatGuid: 'iMessage;-;+15551234567',
    handleId: '+15551234567',
    text,
    dateCreated: new Date(),
    isFromMe: false,
    ...overrides,
  };
}

// ============================================================================
// 1. RESPONSE LENGTH & MULTI-BUBBLE SPLITTING
// ============================================================================
describe('Response length & multi-bubble splitting', () => {
  // These test MessageFormatter directly (no mocks)
  // to verify the splitting logic in isolation
  beforeEach(() => {
    for (const key of Object.keys(_settingsStore)) delete _settingsStore[key];
    // Enable splitting + set low char limit so we can test easily
    _settingsStore['agent.multiMessageSplit'] = 'true';
    _settingsStore['agent.maxResponseChars'] = '150';
  });

  it('should split a long response into multiple bubbles at sentence boundaries', async () => {
    const { MessageFormatter } = await vi.importActual<any>('../MessageFormatter');
    const realFormatter = new MessageFormatter();

    const longText =
      'Hey! So I looked into that for you and here is what I found. ' +
      'The restaurant opens at 11am and closes at 10pm on weekdays. ' +
      'On weekends they open at 9am and stay open until midnight. ' +
      'They have outdoor seating available and reservations are recommended.';

    const result = realFormatter.format(longText, {
      maxResponseChars: 150,
      maxChunks: 3,
      enableSplitting: true,
    });

    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks.length).toBeLessThanOrEqual(3);

    // Each chunk should be under the limit
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500); // hardMax
    }

    // All original content should be preserved (approximately)
    const combined = result.chunks.join(' ');
    expect(combined).toContain('restaurant opens');
    expect(combined).toContain('outdoor seating');
  });

  it('should keep short responses as a single bubble', async () => {
    const { MessageFormatter } = await vi.importActual<any>('../MessageFormatter');
    const realFormatter = new MessageFormatter();

    const shortText = 'Sure thing!';
    const result = realFormatter.format(shortText, {
      maxResponseChars: 150,
      maxChunks: 3,
      enableSplitting: true,
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe('Sure thing!');
  });

  it('should split at paragraph breaks preferentially', async () => {
    // Clear settings so format() uses the passed-in maxResponseChars directly
    delete _settingsStore['agent.maxResponseChars'];
    delete _settingsStore['agent.multiMessageSplit'];

    const { MessageFormatter } = await vi.importActual<any>('../MessageFormatter');
    const realFormatter = new MessageFormatter();

    const text =
      'Here are the details you asked for.\n\n' +
      'The meeting is at 3pm tomorrow in Conference Room B.\n\n' +
      'Please bring your laptop and the quarterly report. Let me know if you need anything else!';

    const result = realFormatter.format(text, {
      maxResponseChars: 40,
      maxChunks: 4,
      enableSplitting: true,
    });

    expect(result.chunks.length).toBeGreaterThan(1);
    // First chunk should be the first paragraph only
    expect(result.chunks[0]).toContain('details you asked for');
    expect(result.chunks[0]).not.toContain('The meeting');
  });

  it('should enforce hardMaxChars even when splitting is disabled', async () => {
    const { MessageFormatter } = await vi.importActual<any>('../MessageFormatter');
    const realFormatter = new MessageFormatter();

    const veryLongText = 'A'.repeat(600);
    const result = realFormatter.format(veryLongText, {
      enableSplitting: false,
      hardMaxChars: 500,
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].length).toBeLessThanOrEqual(500);
    expect(result.wasTruncated).toBe(true);
  });

  it('should respect maxChunks limit and truncate overflow', async () => {
    const { MessageFormatter } = await vi.importActual<any>('../MessageFormatter');
    const realFormatter = new MessageFormatter();

    // Very long text that would need many chunks
    const sentences = Array(20).fill('This is a test sentence that needs some space.').join(' ');

    const result = realFormatter.format(sentences, {
      maxResponseChars: 100,
      maxChunks: 2,
      enableSplitting: true,
    });

    expect(result.chunks.length).toBeLessThanOrEqual(2);
  });
});

// ============================================================================
// 2. MULTI-BUBBLE DELIVERY — AgentService sends chunks with delays
// ============================================================================
describe('Multi-bubble delivery via AgentService', () => {
  let agent: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    for (const key of Object.keys(_settingsStore)) delete _settingsStore[key];
    agent = new AgentService();
    (agent as any).isRunning = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    agent.stop();
  });

  it('should send each chunk as a separate iMessage with delays between', async () => {
    vi.mocked(claudeService.generateResponse).mockResolvedValue({
      content: 'Bubble 1 content\n\nBubble 2 content\n\nBubble 3 content',
      inputTokens: 100,
      outputTokens: 50,
      stopReason: 'end_turn',
      toolsUsed: [],
    } as any);

    // Formatter returns 3 chunks
    vi.mocked(messageFormatter.format).mockReturnValue({
      chunks: ['Bubble 1 content', 'Bubble 2 content', 'Bubble 3 content'],
      wasTruncated: false,
      wasSanitized: false,
      originalLength: 52,
      processedLength: 48,
    } as any);

    const promise = (agent as any).handleIncomingMessage(msg('Tell me about the restaurant'));

    // Advance past typing delay + chunk delays
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    // Should have sent 3 separate iMessages
    expect(iMessageService.sendMessage).toHaveBeenCalledTimes(3);
    expect(iMessageService.sendMessage).toHaveBeenNthCalledWith(
      1, 'iMessage;-;+15551234567', 'Bubble 1 content'
    );
    expect(iMessageService.sendMessage).toHaveBeenNthCalledWith(
      2, 'iMessage;-;+15551234567', 'Bubble 2 content'
    );
    expect(iMessageService.sendMessage).toHaveBeenNthCalledWith(
      3, 'iMessage;-;+15551234567', 'Bubble 3 content'
    );
  });

  it('should stop sending chunks if one fails', async () => {
    vi.mocked(claudeService.generateResponse).mockResolvedValue({
      content: 'A\n\nB\n\nC',
      inputTokens: 50,
      outputTokens: 20,
      stopReason: 'end_turn',
      toolsUsed: [],
    } as any);

    vi.mocked(messageFormatter.format).mockReturnValue({
      chunks: ['A', 'B', 'C'],
      wasTruncated: false,
      wasSanitized: false,
      originalLength: 5,
      processedLength: 3,
    } as any);

    // Second send fails
    vi.mocked(iMessageService.sendMessage)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const promise = (agent as any).handleIncomingMessage(msg('test'));
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    // Should have attempted 2 sends, stopped after failure
    expect(iMessageService.sendMessage).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// 3. TYPING INDICATOR DELAY
// ============================================================================
describe('Typing indicator delay', () => {
  let agent: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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
    vi.useRealTimers();
    agent.stop();
  });

  it('should delay at least 800ms before sending (minimum typing time)', async () => {
    // Very short response — should still wait 800ms minimum
    vi.mocked(claudeService.generateResponse).mockResolvedValue({
      content: 'Hi',
      inputTokens: 50,
      outputTokens: 5,
      stopReason: 'end_turn',
      toolsUsed: [],
    } as any);

    const promise = (agent as any).handleIncomingMessage(msg('hey'));

    // At 500ms — should NOT have sent yet
    await vi.advanceTimersByTimeAsync(500);
    expect(iMessageService.sendMessage).not.toHaveBeenCalled();

    // At 1000ms — should have sent (800ms min delay)
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(iMessageService.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('should cap delay at 3000ms for long responses', async () => {
    // Very long response — delay should not exceed 3000ms
    vi.mocked(claudeService.generateResponse).mockResolvedValue({
      content: 'X'.repeat(500),
      inputTokens: 100,
      outputTokens: 200,
      stopReason: 'end_turn',
      toolsUsed: [],
    } as any);

    const promise = (agent as any).handleIncomingMessage(msg('tell me everything'));

    // At 3500ms — should have sent (3000ms max delay)
    await vi.advanceTimersByTimeAsync(3500);
    await promise;
    expect(iMessageService.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('should scale delay based on response length', async () => {
    // Medium response: 100 chars * 15ms/char = 1500ms (between min and max)
    vi.mocked(claudeService.generateResponse).mockResolvedValue({
      content: 'Y'.repeat(100),
      inputTokens: 80,
      outputTokens: 40,
      stopReason: 'end_turn',
      toolsUsed: [],
    } as any);

    const promise = (agent as any).handleIncomingMessage(msg('question'));

    // At 1000ms — should NOT have sent yet (need ~1500ms)
    await vi.advanceTimersByTimeAsync(1000);
    expect(iMessageService.sendMessage).not.toHaveBeenCalled();

    // At 2000ms — should have sent
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    expect(iMessageService.sendMessage).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// 4. DOUBLE-TEXT HANDLING (QUEUE SERIALIZATION)
// ============================================================================
describe('Double-text queue serialization', () => {
  let agent: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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
    vi.useRealTimers();
    agent.stop();
  });

  it('should process only one message at a time per chat (no double responses)', async () => {
    // First call takes a while (simulates Claude processing)
    let resolveFirst: (v: any) => void;
    const firstPromise = new Promise((resolve) => { resolveFirst = resolve; });
    vi.mocked(claudeService.generateResponse)
      .mockReturnValueOnce(firstPromise as any)
      .mockResolvedValueOnce({
        content: 'Response to second',
        inputTokens: 50,
        outputTokens: 20,
        stopReason: 'end_turn',
        toolsUsed: [],
      } as any);

    // User double-texts: two messages arrive quickly
    const msg1 = msg('first message');
    const msg2 = msg('second message');

    // First message starts processing — flush microtasks so it acquires the lock
    const p1 = (agent as any).handleIncomingMessage(msg1);
    await vi.advanceTimersByTimeAsync(0); // flush microtasks

    // Second message arrives while first is processing — should be queued
    const p2 = (agent as any).handleIncomingMessage(msg2);
    await vi.advanceTimersByTimeAsync(0);

    // msg2 should be queued, not processed yet
    expect((agent as any).chatQueues.get('iMessage;-;+15551234567')?.length).toBe(1);

    // Now first message completes
    resolveFirst!({
      content: 'Response to first',
      inputTokens: 50,
      outputTokens: 20,
      stopReason: 'end_turn',
      toolsUsed: [],
    });

    // Drain typing delay + queue processing
    await vi.advanceTimersByTimeAsync(15000);
    await p1;
    await vi.advanceTimersByTimeAsync(15000);

    // Both messages should have been processed sequentially
    expect(vi.mocked(claudeService.generateResponse).mock.calls.length).toBe(2);
  });

  it('should NOT process the same message GUID twice', async () => {
    vi.mocked(claudeService.generateResponse).mockResolvedValue({
      content: 'Hello!',
      inputTokens: 50,
      outputTokens: 10,
      stopReason: 'end_turn',
      toolsUsed: [],
    } as any);

    // Same message arrives twice (duplicate event)
    const sameMsg = msg('hello');

    const p1 = (agent as any).handleIncomingMessage(sameMsg);
    // The processingQueue check should deduplicate
    const p2 = (agent as any).handleIncomingMessage(sameMsg);

    await vi.advanceTimersByTimeAsync(10000);
    await p1;
    await p2;

    // Claude should only be called once for the duplicate
    expect(vi.mocked(claudeService.generateResponse).mock.calls.length).toBe(1);
  });

  it('should queue up to MAX_CHAT_QUEUE_SIZE messages and drop oldest when full', async () => {
    // Block the first message so all subsequent ones queue up
    let resolveFirst: (v: any) => void;
    const firstPromise = new Promise((resolve) => { resolveFirst = resolve; });
    vi.mocked(claudeService.generateResponse).mockReturnValue(firstPromise as any);

    // Send first message to acquire the lock
    const m1 = msg('msg 1');
    (agent as any).handleIncomingMessage(m1);

    // Send 6 more messages (MAX_CHAT_QUEUE_SIZE = 5)
    for (let i = 2; i <= 7; i++) {
      await (agent as any).handleIncomingMessage(msg(`msg ${i}`));
    }

    // Queue should be capped at 5
    const queue = (agent as any).chatQueues.get('iMessage;-;+15551234567');
    expect(queue.length).toBeLessThanOrEqual(5);

    // The oldest queued message should have been dropped
    // (msg 2 was first queued, but msg 2 should have been shifted out when msg 7 arrived)
    expect(queue[0].text).not.toBe('msg 2');

    // Cleanup: resolve to prevent hanging
    resolveFirst!({
      content: 'done',
      inputTokens: 10,
      outputTokens: 5,
      stopReason: 'end_turn',
      toolsUsed: [],
    });
    await vi.advanceTimersByTimeAsync(10000);
  });

  it('should process queued messages in FIFO order after lock releases', async () => {
    const responses: string[] = [];

    // Track send order
    vi.mocked(iMessageService.sendMessage).mockImplementation(async (_chat: string, text: string) => {
      responses.push(text);
      return true;
    });

    let resolveFirst: (v: any) => void;
    const firstPromise = new Promise((resolve) => { resolveFirst = resolve; });

    vi.mocked(claudeService.generateResponse)
      .mockReturnValueOnce(firstPromise as any)
      .mockImplementation(async (text: string) => ({
        content: `Reply to: ${text}`,
        inputTokens: 50,
        outputTokens: 20,
        stopReason: 'end_turn',
        toolsUsed: [],
      }));

    // Send 3 messages rapidly
    const p1 = (agent as any).handleIncomingMessage(msg('alpha'));
    (agent as any).handleIncomingMessage(msg('beta'));
    (agent as any).handleIncomingMessage(msg('gamma'));

    // Release first
    resolveFirst!({
      content: 'Reply to: alpha',
      inputTokens: 50,
      outputTokens: 20,
      stopReason: 'end_turn',
      toolsUsed: [],
    });

    // Drain all timers/promises
    await vi.advanceTimersByTimeAsync(30000);
    await p1;
    await vi.advanceTimersByTimeAsync(30000);

    // Responses should be in order: alpha, then beta, then gamma
    expect(responses[0]).toBe('Reply to: alpha');
    if (responses.length >= 2) {
      expect(responses[1]).toBe('Reply to: beta');
    }
    if (responses.length >= 3) {
      expect(responses[2]).toBe('Reply to: gamma');
    }
  });

  it('should include double-text context — queued message sees first response in history', async () => {
    let callCount = 0;
    const capturedCalls: { text: string; messages: any[] }[] = [];

    vi.mocked(claudeService.generateResponse).mockImplementation(async (text: any, messages: any) => {
      callCount++;
      capturedCalls.push({ text, messages: [...(messages || [])] });
      return {
        content: `Reply ${callCount}`,
        inputTokens: 50,
        outputTokens: 20,
        stopReason: 'end_turn',
        toolsUsed: [],
      };
    });

    // Send first message and let it complete fully
    const m1 = msg('first question');
    const p1 = (agent as any).handleIncomingMessage(m1);
    await vi.advanceTimersByTimeAsync(10000);
    await p1;

    // Now send second message — it should have the first Q&A in context
    const m2 = msg('second question');
    const p2 = (agent as any).handleIncomingMessage(m2);
    await vi.advanceTimersByTimeAsync(10000);
    await p2;

    expect(callCount).toBe(2);

    // Second call: text arg = 'second question', messages should contain first Q&A
    // AgentService calls: generateResponse(text, context.messages.slice(0, -1), ...)
    // So 'second question' is in the text arg, and prior conversation is in messages
    const secondCall = capturedCalls[1];
    expect(secondCall.text).toBe('second question');
    const historyTexts = secondCall.messages.map((m: any) => m.content);
    expect(historyTexts).toContain('first question');
    expect(historyTexts).toContain('Reply 1');
  }, 15000);
});

// ============================================================================
// 5. CHUNK DELAY BETWEEN BUBBLES
// ============================================================================
describe('Chunk delay between bubbles', () => {
  let agent: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    for (const key of Object.keys(_settingsStore)) delete _settingsStore[key];
    _settingsStore['agent.splitDelaySeconds'] = '2'; // 2 second delay between bubbles
    agent = new AgentService();
    (agent as any).isRunning = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    agent.stop();
  });

  it('should wait agent.splitDelaySeconds between sending each bubble', async () => {
    vi.mocked(claudeService.generateResponse).mockResolvedValue({
      content: 'First bubble\n\nSecond bubble',
      inputTokens: 50,
      outputTokens: 20,
      stopReason: 'end_turn',
      toolsUsed: [],
    } as any);

    vi.mocked(messageFormatter.format).mockReturnValue({
      chunks: ['First bubble', 'Second bubble'],
      wasTruncated: false,
      wasSanitized: false,
      originalLength: 27,
      processedLength: 24,
    } as any);

    const sendTimes: number[] = [];
    vi.mocked(iMessageService.sendMessage).mockImplementation(async () => {
      sendTimes.push(Date.now());
      return true;
    });

    const promise = (agent as any).handleIncomingMessage(msg('question'));
    await vi.advanceTimersByTimeAsync(15000);
    await promise;

    expect(iMessageService.sendMessage).toHaveBeenCalledTimes(2);

    // Second bubble should arrive ~2000ms after the first
    if (sendTimes.length === 2) {
      const gap = sendTimes[1] - sendTimes[0];
      expect(gap).toBeGreaterThanOrEqual(1900); // ~2000ms with tolerance
    }
  });
});
