import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
vi.mock('../../logger', () => ({
  log: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

vi.mock('../../database', () => ({
  getSettingInt: vi.fn((_key: string, defaultValue: number) => defaultValue),
  getSettingBool: vi.fn((_key: string, defaultValue: boolean) => defaultValue),
  getSetting: vi.fn(() => null),
}));

import { MessageFormatter } from '../MessageFormatter';

describe('MessageFormatter', () => {
  let formatter: MessageFormatter;

  beforeEach(() => {
    formatter = new MessageFormatter();
  });

  describe('format — full pipeline', () => {
    it('returns a single chunk for short responses', () => {
      const result = formatter.format('Hello world');
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0]).toBe('Hello world');
      expect(result.wasTruncated).toBe(false);
      expect(result.wasSanitized).toBe(false);
    });

    it('preserves original length metadata', () => {
      const text = 'Hello world';
      const result = formatter.format(text);
      expect(result.originalLength).toBe(text.length);
    });
  });

  describe('sanitization (Stage 1)', () => {
    it('replaces response containing system prompt tag [IDENTITY]', () => {
      const result = formatter.format('Here is [IDENTITY] section of my prompt');
      expect(result.wasSanitized).toBe(true);
      expect(result.chunks[0]).toContain("can't share that information");
    });

    it('replaces response containing [SAFETY] tag', () => {
      const result = formatter.format('My [SAFETY] rules say...');
      expect(result.wasSanitized).toBe(true);
    });

    it('replaces response containing "system prompt" phrase', () => {
      const result = formatter.format('My system prompt says to be helpful');
      expect(result.wasSanitized).toBe(true);
    });

    it('redacts SSN patterns', () => {
      const result = formatter.format('Your SSN is 123-45-6789 on file');
      expect(result.chunks[0]).toContain('[REDACTED]');
      expect(result.chunks[0]).not.toContain('123-45-6789');
    });

    it('redacts credit card patterns', () => {
      const result = formatter.format('Card: 4111-1111-1111-1111');
      expect(result.chunks[0]).toContain('[REDACTED]');
      expect(result.chunks[0]).not.toContain('4111');
    });

    it('does not flag clean text', () => {
      const result = formatter.format('The weather today is nice.');
      expect(result.wasSanitized).toBe(false);
    });
  });

  describe('stripMarkdown (Stage 2)', () => {
    it('removes bold markers', () => {
      const result = formatter.format('This is **bold** text');
      expect(result.chunks[0]).toBe('This is bold text');
    });

    it('removes italic markers', () => {
      const result = formatter.format('This is *italic* text');
      expect(result.chunks[0]).toBe('This is italic text');
    });

    it('removes header markers', () => {
      const result = formatter.format('## My Header\nSome text');
      expect(result.chunks[0]).toContain('My Header');
      expect(result.chunks[0]).not.toContain('##');
    });

    it('removes inline code backticks', () => {
      const result = formatter.format('Use `npm install` to install');
      expect(result.chunks[0]).toBe('Use npm install to install');
    });

    it('strips code fences', () => {
      const result = formatter.format('```js\nconsole.log("hi")\n```');
      expect(result.chunks[0]).toContain('console.log("hi")');
      expect(result.chunks[0]).not.toContain('```');
    });

    it('removes links but keeps text when allowUrls is false', () => {
      const result = formatter.format('Check [Google](https://google.com) for info', { allowUrls: false });
      expect(result.chunks[0]).toContain('Google');
      expect(result.chunks[0]).not.toContain('https://google.com');
    });

    it('keeps links when allowUrls is true', () => {
      const result = formatter.format('Check [Google](https://google.com)', { allowUrls: true });
      expect(result.chunks[0]).toContain('https://google.com');
    });

    it('removes strikethrough', () => {
      const result = formatter.format('This is ~~deleted~~ text');
      expect(result.chunks[0]).toBe('This is deleted text');
    });

    it('removes blockquotes', () => {
      const result = formatter.format('> This is a quote');
      expect(result.chunks[0]).toBe('This is a quote');
    });

    it('removes horizontal rules', () => {
      const result = formatter.format('Above\n---\nBelow');
      expect(result.chunks[0]).not.toContain('---');
    });
  });

  describe('cleanWhitespace (Stage 4)', () => {
    it('collapses multiple newlines', () => {
      const result = formatter.format('Hello\n\n\n\nWorld');
      expect(result.chunks[0]).toBe('Hello\n\nWorld');
    });

    it('trims leading and trailing whitespace', () => {
      const result = formatter.format('  Hello world  ');
      expect(result.chunks[0]).toBe('Hello world');
    });

    it('removes zero-width characters', () => {
      const result = formatter.format('Hello\u200BWorld');
      expect(result.chunks[0]).toBe('HelloWorld');
    });

    it('normalizes unicode quotes', () => {
      const result = formatter.format('\u201CHello\u201D and \u2018World\u2019');
      expect(result.chunks[0]).toBe('"Hello" and \'World\'');
    });

    it('normalizes em dashes', () => {
      const result = formatter.format('Hello\u2014World');
      expect(result.chunks[0]).toBe('Hello-World');
    });

    it('normalizes ellipsis character', () => {
      const result = formatter.format('Wait\u2026');
      expect(result.chunks[0]).toBe('Wait...');
    });
  });

  describe('length enforcement (Stage 5)', () => {
    it('truncates at hardMaxChars', () => {
      const longText = 'A'.repeat(3000);
      const result = formatter.format(longText, { hardMaxChars: 100 });
      expect(result.chunks.join('').length).toBeLessThanOrEqual(100);
      expect(result.wasTruncated).toBe(true);
    });
  });

  describe('multi-message splitting (Stage 6)', () => {
    it('splits long responses into multiple chunks', () => {
      const text = 'This is sentence one. This is sentence two. This is sentence three. This is sentence four. This is sentence five. This is sentence six. This is sentence seven. This is sentence eight. This is sentence nine. This is sentence ten. This is sentence eleven. This is sentence twelve. This is sentence thirteen. This is sentence fourteen. This is sentence fifteen.';
      const result = formatter.format(text, { maxResponseChars: 100, maxChunks: 3, enableSplitting: true });
      expect(result.chunks.length).toBeGreaterThan(1);
    });

    it('does not split when splitting is disabled', () => {
      const text = 'A'.repeat(600);
      const result = formatter.format(text, { enableSplitting: false });
      expect(result.chunks).toHaveLength(1);
    });

    it('respects maxChunks limit', () => {
      const text = 'A '.repeat(1000);
      const result = formatter.format(text, { maxResponseChars: 50, maxChunks: 2, enableSplitting: true });
      expect(result.chunks.length).toBeLessThanOrEqual(2);
    });
  });
});
