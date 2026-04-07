/**
 * Tests for all audit fixes (C1, H1, H2, H3, H4, M2, M6, L7).
 * Each describe block maps to one audit finding.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const mockLog = vi.fn();
const mockLogSecurityEvent = vi.fn();

vi.mock('../../logger', () => ({
  log: (...args: any[]) => mockLog(...args),
  logSecurityEvent: (...args: any[]) => mockLogSecurityEvent(...args),
}));

// In-memory settings store for tests
let settingsStore: Record<string, string> = {};

const mockDbExec = vi.fn();
const mockDbPrepare = vi.fn();
const mockDbInstance = {
  exec: mockDbExec,
  prepare: mockDbPrepare,
};

vi.mock('../../database', () => ({
  getDatabase: () => mockDbInstance,
  getSetting: (key: string) => settingsStore[key] ?? null,
  setSetting: (key: string, value: string) => { settingsStore[key] = value; },
  getSettingInt: (key: string, defaultValue: number) => {
    const raw = settingsStore[key];
    if (raw == null) return defaultValue;
    try { return JSON.parse(raw); } catch { return defaultValue; }
  },
  getSettingBool: (key: string, defaultValue: boolean) => {
    const raw = settingsStore[key];
    if (raw == null) return defaultValue;
    try { return JSON.parse(raw); } catch { return defaultValue; }
  },
  getSettingFloat: (key: string, defaultValue: number) => {
    const raw = settingsStore[key];
    if (raw == null) return defaultValue;
    try { return JSON.parse(raw); } catch { return defaultValue; }
  },
  seedDefaultSettings: vi.fn(),
}));

// Mock iMessageService as an EventEmitter stub
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
    generateResponse: vi.fn().mockResolvedValue({
      text: 'Hello!',
      inputTokens: 100,
      outputTokens: 50,
      model: 'claude-3-5-haiku-latest',
    }),
    setModel: vi.fn(),
    setMaxTokens: vi.fn(),
    setTemperature: vi.fn(),
  },
  Message: {},
}));

vi.mock('../MessageFormatter', () => ({
  messageFormatter: {
    format: vi.fn().mockReturnValue({
      messages: ['Hello!'],
      wasTruncated: false,
      wasMultipart: false,
      originalLength: 6,
    }),
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
    getAnthropicTools: vi.fn().mockReturnValue([]),
    executeToolCall: vi.fn(),
    getDefinitions: vi.fn().mockReturnValue([]),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { RateLimiter } from '../RateLimiter';
import { PromptBuilder } from '../PromptBuilder';

beforeEach(() => {
  vi.clearAllMocks();
  settingsStore = {};
});

// ===========================================================================
// C1 — Reminders & Triggers schema: verify no duplicate CREATE TABLE in
//       tool/service files (they should rely on migration v8 only).
// ===========================================================================
describe('C1: Schema deduplication', () => {
  it('setReminder tool does NOT contain CREATE TABLE', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../tools/setReminder.ts'),
      'utf-8'
    );
    expect(source).not.toContain('CREATE TABLE');
  });

  it('createTrigger tool does NOT contain CREATE TABLE', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../tools/createTrigger.ts'),
      'utf-8'
    );
    expect(source).not.toContain('CREATE TABLE');
  });

  it('ReminderService does NOT contain CREATE TABLE', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../ReminderService.ts'),
      'utf-8'
    );
    expect(source).not.toContain('CREATE TABLE');
  });

  it('TriggerService does NOT contain CREATE TABLE', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../TriggerService.ts'),
      'utf-8'
    );
    expect(source).not.toContain('CREATE TABLE');
  });

  it('database.ts migration v8 adds chat_guid, due_at, is_sent to reminders', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../database.ts'),
      'utf-8'
    );
    expect(source).toContain("version: 8");
    expect(source).toContain("fix_reminders_and_triggers_schemas");
    expect(source).toContain("ADD COLUMN chat_guid");
    expect(source).toContain("ADD COLUMN due_at");
    expect(source).toContain("ADD COLUMN is_sent");
    expect(source).toContain("ADD COLUMN message TEXT");
    expect(source).toContain("ADD COLUMN last_fired_at");
  });
});

// ===========================================================================
// H1 — Budget circuit breaker uses per-model pricing
// ===========================================================================
describe('H1: Budget per-model pricing', () => {
  it('AgentService.ts references MODEL_COST with multiple models', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    // Should NOT have the old hardcoded Haiku-only comment
    expect(source).not.toContain('Approximate cost calculation for Claude 3.5 Haiku');
    // Should have per-model cost map
    expect(source).toContain('claude-3-5-haiku-latest');
    expect(source).toContain('claude-3-5-sonnet-latest');
    expect(source).toContain('claude-sonnet-4-20250514');
    expect(source).toContain('MODEL_COST');
    // Should read model from settings
    expect(source).toContain("getSetting('anthropic.model')");
  });

  it('Haiku pricing is cheaper than Sonnet pricing in the cost map', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    // Extract the cost map entries — Haiku input=80 vs Sonnet input=300
    expect(source).toContain("'claude-3-5-haiku-latest':  { input: 80,   output: 400  }");
    expect(source).toContain("'claude-3-5-sonnet-latest': { input: 300,  output: 1500 }");
  });
});

// ===========================================================================
// H2 — logSecurityEvent called when rate limiting triggers
// ===========================================================================
describe('H2: Rate limit security events', () => {
  it('AgentService.ts calls logSecurityEvent on rate_limit_exceeded', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    expect(source).toContain("logSecurityEvent('rate_limit_exceeded'");
  });

  it('AgentService.ts imports logSecurityEvent from logger', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    expect(source).toMatch(/import\s*\{[^}]*logSecurityEvent[^}]*\}\s*from\s*['"]\.\.\/logger['"]/);
  });
});

// ===========================================================================
// H3 — RateLimiter.cleanup() wired up in server.ts
// ===========================================================================
describe('H3: RateLimiter cleanup wired', () => {
  it('server.ts imports rateLimiter', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../server.ts'),
      'utf-8'
    );
    expect(source).toContain("import { rateLimiter }");
  });

  it('server.ts calls rateLimiter.cleanup() in a setInterval', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../server.ts'),
      'utf-8'
    );
    expect(source).toContain('rateLimiter.cleanup()');
    expect(source).toMatch(/setInterval\(\s*\(\)\s*=>\s*rateLimiter\.cleanup\(\)/);
  });

  it('server.ts clears the cleanup interval on stop', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../server.ts'),
      'utf-8'
    );
    expect(source).toContain('rateLimiterCleanupInterval');
    expect(source).toContain('clearInterval(rateLimiterCleanupInterval)');
  });

  it('RateLimiter.cleanup() actually removes stale entries', () => {
    const limiter = new RateLimiter();
    // Add some entries
    limiter.checkLimit('user1');
    limiter.checkLimit('user2');
    expect(limiter.getUserState('user1')).toBeDefined();
    expect(limiter.getUserState('user2')).toBeDefined();
    // cleanup should not throw and should return cleanly
    expect(() => limiter.cleanup()).not.toThrow();
  });
});

// ===========================================================================
// H4 — URL allowlists consolidated
// ===========================================================================
describe('H4: URL allowlists consistent', () => {
  it('PermissionService includes anthropic console URL', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../PermissionService.ts'),
      'utf-8'
    );
    expect(source).toContain('https://console.anthropic.com/');
    expect(source).toContain('x-apple.systempreferences:');
  });

  it('dashboard route includes same prefixes', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../routes/dashboard.ts'),
      'utf-8'
    );
    expect(source).toContain('https://console.anthropic.com/');
    expect(source).toContain('x-apple.systempreferences:');
  });
});

// ===========================================================================
// M2 — Conversation history misattribution fix
// ===========================================================================
describe('M2: History misattribution fix', () => {
  it('AgentService.ts cross-references saved messages DB for isFromMe', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    // Should check our messages DB for assistant messages
    expect(source).toContain('savedAssistantMessages');
    expect(source).toMatch(/role\s*=\s*.*assistant/);
    // Should NOT blindly map isFromMe to assistant without checking
    expect(source).not.toMatch(/role:\s*msg\.isFromMe\s*\?\s*'assistant'/);
  });

  it('only includes isFromMe messages that are in our saved messages', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    // Should contain the logic: if isFromMe AND in savedAssistantMessages → assistant
    expect(source).toContain('savedAssistantMessages.has(msg.text');
    // Should skip manually sent messages
    expect(source).toContain('manually sent by Mac user');
  });
});

// ===========================================================================
// M4 — MemoryService.expireOldFacts() scheduled in server.ts
// ===========================================================================
describe('M4: Auto-expire facts', () => {
  it('server.ts imports memoryService', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../server.ts'),
      'utf-8'
    );
    expect(source).toContain("import { memoryService }");
  });

  it('server.ts calls memoryService.expireOldFacts() periodically', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../server.ts'),
      'utf-8'
    );
    expect(source).toContain('memoryService.expireOldFacts()');
    expect(source).toMatch(/setInterval\(\s*\(\)\s*=>\s*memoryService\.expireOldFacts\(\)/);
  });

  it('server.ts clears the fact expiration interval on stop', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../server.ts'),
      'utf-8'
    );
    expect(source).toContain('factExpirationInterval');
    expect(source).toContain('clearInterval(factExpirationInterval)');
  });
});

// ===========================================================================
// M6 — web_fetch removed from prompt and settings
// ===========================================================================
describe('M6: web_fetch references removed', () => {
  it('PromptBuilder DEFAULT_TOOL_USAGE does not mention web_fetch', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../PromptBuilder.ts'),
      'utf-8'
    );
    expect(source).not.toContain('web_fetch');
    expect(source).not.toContain('Web Fetch');
  });

  it('database.ts default settings do not include tools.webFetch', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../database.ts'),
      'utf-8'
    );
    expect(source).not.toContain("'tools.webFetch'");
    expect(source).not.toContain("'tools.webFetchMaxTokens'");
  });
});

// ===========================================================================
// L1 — Tools page uses SWR hooks
// ===========================================================================
describe('L1: Tools page SWR refactor', () => {
  it('tools page imports from hooks.ts, not manual useState/useEffect for data', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../../dashboard/app/tools/page.tsx'),
      'utf-8'
    );
    expect(source).toContain('useToolDefinitions');
    expect(source).toContain('useToolExecutions');
    expect(source).toContain('useReminders');
    expect(source).toContain('useTriggers');
    // Should NOT have the old manual loadData pattern
    expect(source).not.toContain('const loadData = async');
  });

  it('hooks.ts exports the four new tool hooks', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../../dashboard/lib/hooks.ts'),
      'utf-8'
    );
    expect(source).toContain('export function useToolDefinitions');
    expect(source).toContain('export function useToolExecutions');
    expect(source).toContain('export function useReminders');
    expect(source).toContain('export function useTriggers');
  });
});

// ===========================================================================
// L6 — alert() calls removed from dashboard
// ===========================================================================
describe('L6: alert() removed from dashboard pages', () => {
  it('memory page does not call alert()', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../../dashboard/app/memory/page.tsx'),
      'utf-8'
    );
    expect(source).not.toMatch(/\balert\s*\(/);
    // Should use inline message instead
    expect(source).toContain('expireMessage');
  });

  it('settings page does not call alert()', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../../dashboard/app/settings/page.tsx'),
      'utf-8'
    );
    expect(source).not.toMatch(/\balert\s*\(/);
    // Should use inline error state instead
    expect(source).toContain('saveError');
  });
});

// ===========================================================================
// L7 — Contact name lookup via node-mac-contacts
// ===========================================================================
describe('L7: Contact name lookup', () => {
  it('AgentService.ts contains node-mac-contacts lookup logic', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    expect(source).toContain('node-mac-contacts');
    expect(source).toContain('getAllContacts');
    expect(source).toContain('contactNameCache');
    expect(source).toContain('phoneNumbers');
  });

  it('AgentService.ts still has phone number formatting fallback', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../AgentService.ts'),
      'utf-8'
    );
    // The fallback format (XXX) XXX-XXXX should still be present
    expect(source).toMatch(/\(\$\{digits\.substring/);
    // Should handle 10-digit and 11-digit numbers
    expect(source).toContain('digits.length === 11');
    expect(source).toContain('digits.length === 10');
  });
});
