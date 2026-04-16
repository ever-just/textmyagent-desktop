import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
vi.mock('../../logger', () => ({
  log: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

vi.mock('../../database', () => ({
  getSetting: vi.fn(() => null),
  getSettingInt: vi.fn((_key: string, defaultValue: number) => defaultValue),
  getSettingBool: vi.fn((_key: string, defaultValue: boolean) => defaultValue),
}));

import { PromptBuilder } from '../PromptBuilder';

describe('PromptBuilder', () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    builder = new PromptBuilder();
  });

  describe('build', () => {
    it('includes IDENTITY section', () => {
      const prompt = builder.build();
      expect(prompt).toContain('[IDENTITY]');
    });

    it('includes PERSONA section', () => {
      const prompt = builder.build();
      expect(prompt).toContain('[PERSONA]');
    });

    it('includes GUIDELINES section', () => {
      const prompt = builder.build();
      expect(prompt).toContain('[GUIDELINES]');
    });

    it('includes SAFETY section', () => {
      const prompt = builder.build();
      expect(prompt).toContain('[SAFETY]');
    });

    it('includes FORMAT section', () => {
      const prompt = builder.build();
      expect(prompt).toContain('[FORMAT]');
    });

    it('does not include dynamic sections when no context is provided', () => {
      const prompt = builder.build();
      expect(prompt).not.toContain('[CONTEXT]');
      expect(prompt).not.toContain('[CONTACT]');
      expect(prompt).not.toContain('[USER_MEMORY]');
      expect(prompt).not.toContain('[TOOLS]');
    });
  });

  describe('build with context', () => {
    it('includes date context when provided', () => {
      const prompt = builder.build({ date: '2025-01-01 12:00:00' });
      expect(prompt).toContain('[CONTEXT]');
      expect(prompt).toContain('2025-01-01 12:00:00');
    });

    it('includes contact name when provided', () => {
      const prompt = builder.build({ contactName: 'Alice' });
      expect(prompt).toContain('[CONTACT]');
      expect(prompt).toContain('Alice');
    });

    it('includes group chat info when provided', () => {
      const prompt = builder.build({ chatType: 'group', participantCount: 5 });
      expect(prompt).toContain('[CHAT_TYPE]');
      expect(prompt).toContain('5 participants');
    });

    it('does not include CHAT_TYPE for individual chats', () => {
      const prompt = builder.build({ chatType: 'individual' });
      expect(prompt).not.toContain('[CHAT_TYPE]');
    });

    it('includes user facts when provided', () => {
      const prompt = builder.build({
        userFacts: [
          { id: '1', userId: 'u1', content: 'Likes coffee', type: 'preference', source: 'conversation', confidence: 0.9, createdAt: '', lastUsedAt: '', expiresAt: null },
          { id: '2', userId: 'u1', content: 'Lives in NYC', type: 'personal', source: 'conversation', confidence: 0.8, createdAt: '', lastUsedAt: '', expiresAt: null },
        ],
      });
      expect(prompt).toContain('[USER_MEMORY]');
      expect(prompt).toContain('Likes coffee');
      expect(prompt).toContain('Lives in NYC');
    });

    it('does not include USER_MEMORY when facts array is empty', () => {
      const prompt = builder.build({ userFacts: [] });
      expect(prompt).not.toContain('[USER_MEMORY]');
    });

    it('includes conversation summary when provided', () => {
      const prompt = builder.build({ conversationSummary: 'Discussed weather and travel.' });
      expect(prompt).toContain('[CONVERSATION_SUMMARY]');
      expect(prompt).toContain('Discussed weather and travel.');
    });

    it('includes tools section when tools are provided', () => {
      const prompt = builder.build({ enabledTools: ['web_search', 'save_user_fact'] });
      expect(prompt).toContain('[TOOLS]');
      expect(prompt).toContain('web_search');
      expect(prompt).toContain('save_user_fact');
    });

    it('does not include TOOLS when tools array is empty', () => {
      const prompt = builder.build({ enabledTools: [] });
      expect(prompt).not.toContain('[TOOLS]');
    });
  });

  describe('build (plain string)', () => {
    it('returns a string containing all static sections', () => {
      const prompt = builder.build();
      expect(typeof prompt).toBe('string');
      expect(prompt).toContain('[IDENTITY]');
      expect(prompt).toContain('[PERSONA]');
      expect(prompt).toContain('[GUIDELINES]');
      expect(prompt).toContain('[SAFETY]');
      expect(prompt).toContain('[FORMAT]');
    });

    it('includes dynamic context when provided', () => {
      const prompt = builder.build({ date: '2025-01-01', contactName: 'Bob' });
      expect(prompt).toContain('[CONTEXT]');
      expect(prompt).toContain('[CONTACT]');
    });

    it('includes DATA_BOUNDARY when no dynamic context', () => {
      const prompt = builder.build();
      expect(prompt).toContain('[DATA_BOUNDARY]');
    });
  });

  describe('preview', () => {
    it('returns prompt string, section list, and char count', () => {
      const result = builder.preview();
      expect(result.prompt).toContain('[IDENTITY]');
      expect(result.sections).toContain('IDENTITY');
      expect(result.sections).toContain('SAFETY');
      expect(result.charCount).toBeGreaterThan(0);
      expect(result.charCount).toBe(result.prompt.length);
    });

    it('includes dynamic sections in section list', () => {
      const result = builder.preview({ date: '2025-01-01' });
      expect(result.sections).toContain('CONTEXT');
    });
  });

  describe('settings override', () => {
    it('uses setting value when getSetting returns a value', async () => {
      const { getSetting } = await import('../../database');
      (getSetting as ReturnType<typeof vi.fn>).mockReturnValueOnce(JSON.stringify('I am a custom AI named Bob.'));

      const prompt = builder.build();
      expect(prompt).toContain('I am a custom AI named Bob.');
    });
  });
});
