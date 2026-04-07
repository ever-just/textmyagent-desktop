import { log } from '../logger';
import { logSecurityEvent } from '../logger';
import { getSettingBool, getSettingInt } from '../database';
import type { FormatterOptions, FormatterResult } from '../types';

/**
 * MessageFormatter — 7-stage response processing pipeline.
 * Phase 2a, Task 2.2
 *
 * Every Claude response passes through these stages IN ORDER before reaching iMessage:
 *   1. Sanitize (output safety check)
 *   2. Strip markdown
 *   3. Format citations
 *   4. Clean whitespace
 *   5. Enforce length limits
 *   6. Multi-message splitting
 *   7. (Send — handled by caller)
 */

const DEFAULT_OPTIONS: FormatterOptions = {
  maxResponseChars: 300,
  hardMaxChars: 500,
  maxChunks: 1,
  chunkDelayMs: 1500,
  stripMarkdown: true,
  allowUrls: false,
  maxCitations: 2,
  enableSplitting: false,
};

// Patterns that indicate system prompt leakage
const SYSTEM_PROMPT_PATTERNS = [
  /\[IDENTITY\]/i,
  /\[SAFETY\]/i,
  /\[GUIDELINES\]/i,
  /\[PERSONA\]/i,
  /\[FORMAT\]/i,
  /system prompt/i,
  /my instructions are/i,
  /i was programmed to/i,
  /my system message/i,
];

// PII patterns (simplified — catches common formats)
const PII_PATTERNS = [
  /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/, // SSN
  /\b\d{4}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/, // Credit card
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email — only flag if in AI output
];

export class MessageFormatter {
  /**
   * Run the full formatting pipeline on a raw Claude response.
   */
  format(rawResponse: string, options?: Partial<FormatterOptions>): FormatterResult {
    const opts: FormatterOptions = { ...DEFAULT_OPTIONS, ...options };

    // Override from settings
    opts.maxResponseChars = getSettingInt('agent.maxResponseChars', opts.maxResponseChars);
    opts.enableSplitting = getSettingBool('agent.multiMessageSplit', opts.enableSplitting);

    const originalLength = rawResponse.length;
    let text = rawResponse;
    let wasSanitized = false;
    let wasTruncated = false;

    // Stage 1: SANITIZE
    const sanitizeResult = this.sanitize(text);
    text = sanitizeResult.text;
    wasSanitized = sanitizeResult.flagged;

    // Stage 2: STRIP MARKDOWN
    if (opts.stripMarkdown) {
      text = this.stripMarkdown(text, opts.allowUrls);
    }

    // Stage 3: FORMAT CITATIONS
    text = this.formatCitations(text, opts.maxCitations, opts.allowUrls);

    // Stage 4: CLEAN WHITESPACE
    text = this.cleanWhitespace(text);

    // Stage 5: ENFORCE LENGTH LIMITS
    if (text.length > opts.hardMaxChars) {
      text = text.substring(0, opts.hardMaxChars - 3) + '...';
      wasTruncated = true;
    }

    // Stage 6: MULTI-MESSAGE SPLITTING
    let chunks: string[];
    if (opts.enableSplitting && text.length > opts.maxResponseChars) {
      chunks = this.splitIntoChunks(text, opts.maxResponseChars, opts.maxChunks);
      if (chunks.length > 1) {
        wasTruncated = wasTruncated || chunks.some((c) => c.endsWith('...'));
      }
    } else {
      chunks = [text];
    }

    const processedLength = chunks.reduce((sum, c) => sum + c.length, 0);

    return {
      chunks,
      wasTruncated,
      wasSanitized,
      originalLength,
      processedLength,
    };
  }

  /**
   * Stage 1: SANITIZE — check for system prompt leaks and PII.
   */
  private sanitize(text: string): { text: string; flagged: boolean } {
    const sanitizationEnabled = getSettingBool('security.outputSanitization', true);
    if (!sanitizationEnabled) return { text, flagged: false };

    // Check for system prompt leakage
    for (const pattern of SYSTEM_PROMPT_PATTERNS) {
      if (pattern.test(text)) {
        logSecurityEvent('output_sanitized', null, { reason: 'system_prompt_leak', pattern: pattern.source }, 'high');
        return {
          text: "I'm sorry, I can't share that information. Is there something else I can help you with?",
          flagged: true,
        };
      }
    }

    // Check for PII in AI-generated output
    // Note: We don't flag PII that the user sent — only PII the AI is generating
    for (const pattern of PII_PATTERNS) {
      if (pattern.test(text)) {
        logSecurityEvent('output_sanitized', null, { reason: 'pii_detected', pattern: pattern.source }, 'medium');
        // Replace the PII match rather than replacing the whole message
        text = text.replace(pattern, '[REDACTED]');
      }
    }

    return { text, flagged: false };
  }

  /**
   * Stage 2: STRIP MARKDOWN — remove markdown formatting for iMessage.
   */
  private stripMarkdown(text: string, allowUrls: boolean): string {
    let result = text;

    // Remove code fences (```...```)
    result = result.replace(/```[\s\S]*?```/g, (match) => {
      // Extract just the code content, strip the fences
      const lines = match.split('\n');
      // Remove first and last lines (the fence markers)
      if (lines.length > 2) {
        return lines.slice(1, -1).join('\n');
      }
      return match.replace(/```\w*/g, '').trim();
    });

    // Remove inline code (`code`)
    result = result.replace(/`([^`]+)`/g, '$1');

    // Remove headers (# ## ### etc.)
    result = result.replace(/^#{1,6}\s+/gm, '');

    // Remove bold (**text** or __text__)
    result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
    result = result.replace(/__([^_]+)__/g, '$1');

    // Remove italic (*text* or _text_) — careful not to catch emphasis in normal text
    result = result.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1');
    result = result.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1');

    // Remove strikethrough (~~text~~)
    result = result.replace(/~~([^~]+)~~/g, '$1');

    // Handle links [text](url)
    if (allowUrls) {
      // Keep both text and URL
      result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
    } else {
      // Keep text only, drop URL
      result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
    }

    // Remove image syntax ![alt](url)
    result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

    // Remove horizontal rules (--- or ***)
    result = result.replace(/^[-*_]{3,}\s*$/gm, '');

    // Remove blockquotes (> text)
    result = result.replace(/^>\s?/gm, '');

    // Simplify bullet markers for short lists, keep for longer ones
    const bulletLines = result.match(/^[\s]*[-*•]\s/gm);
    if (bulletLines && bulletLines.length <= 2) {
      // Short list — remove bullets, keep as plain text
      result = result.replace(/^[\s]*[-*•]\s+/gm, '');
    } else if (bulletLines && bulletLines.length > 2) {
      // Longer list — convert to numbered list
      let counter = 0;
      result = result.replace(/^[\s]*[-*•]\s+/gm, () => {
        counter++;
        return `${counter}. `;
      });
    }

    return result;
  }

  /**
   * Stage 3: FORMAT CITATIONS — reformat web search citations for iMessage.
   */
  private formatCitations(text: string, maxCitations: number, allowUrls: boolean): string {
    let result = text;
    let citationCount = 0;

    // Pattern: [Source Title](URL) or numbered references like [1], [2]
    // Replace with natural language citations
    result = result.replace(/\[(\d+)\]\s*\(([^)]+)\)/g, (_match, _num, url) => {
      citationCount++;
      if (citationCount > maxCitations) return '';
      return allowUrls ? `(${url})` : '';
    });

    // Remove remaining numbered reference markers [1], [2], etc.
    result = result.replace(/\[(\d+)\]/g, '');

    // Clean up any double spaces left from removed citations
    result = result.replace(/ {2,}/g, ' ');

    return result;
  }

  /**
   * Stage 4: CLEAN WHITESPACE — normalize whitespace and special characters.
   */
  private cleanWhitespace(text: string): string {
    let result = text;

    // Collapse 3+ consecutive newlines to 2
    result = result.replace(/\n{3,}/g, '\n\n');

    // Trim leading/trailing whitespace
    result = result.trim();

    // Remove zero-width characters
    result = result.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');

    // Normalize unicode quotes to ASCII
    result = result.replace(/[\u2018\u2019]/g, "'");
    result = result.replace(/[\u201C\u201D]/g, '"');

    // Normalize em/en dashes to hyphens
    result = result.replace(/[\u2013\u2014]/g, '-');

    // Normalize ellipsis character to three dots
    result = result.replace(/\u2026/g, '...');

    // Clean up multiple spaces on a single line
    result = result.replace(/ {2,}/g, ' ');

    return result;
  }

  /**
   * Stage 6: MULTI-MESSAGE SPLITTING — split long responses at natural boundaries.
   */
  private splitIntoChunks(text: string, maxChunkChars: number, maxChunks: number): string[] {
    if (text.length <= maxChunkChars) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0 && chunks.length < maxChunks) {
      if (remaining.length <= maxChunkChars) {
        chunks.push(remaining.trim());
        break;
      }

      // Find the best split point within maxChunkChars
      const splitPoint = this.findSplitPoint(remaining, maxChunkChars);
      const chunk = remaining.substring(0, splitPoint).trim();
      remaining = remaining.substring(splitPoint).trim();

      if (chunk.length > 0) {
        chunks.push(chunk);
      }
    }

    // If there's still remaining text after max chunks, truncate the last chunk
    if (remaining.length > 0 && chunks.length >= maxChunks) {
      const lastIdx = chunks.length - 1;
      if (chunks[lastIdx].length + remaining.length > maxChunkChars) {
        chunks[lastIdx] = chunks[lastIdx].substring(0, maxChunkChars - 3) + '...';
      } else {
        chunks[lastIdx] += ' ' + remaining;
      }
    }

    return chunks.filter((c) => c.length > 0);
  }

  /**
   * Find the best split point within maxChars, prioritizing natural boundaries.
   */
  private findSplitPoint(text: string, maxChars: number): number {
    const searchRange = text.substring(0, maxChars);

    // Priority 1: Double newline (paragraph break)
    const doubleNewline = searchRange.lastIndexOf('\n\n');
    if (doubleNewline > maxChars * 0.3) return doubleNewline + 2;

    // Priority 2: Single newline after sentence end
    const newlineAfterSentence = searchRange.search(/[.!?]\s*\n(?!$)/);
    if (newlineAfterSentence > maxChars * 0.3) {
      // Find the actual newline position
      const nlPos = searchRange.indexOf('\n', newlineAfterSentence);
      if (nlPos > 0) return nlPos + 1;
    }

    // Priority 3: Sentence boundary (. ! ? followed by space)
    let lastSentenceEnd = -1;
    const sentencePattern = /[.!?]\s+/g;
    let match;
    while ((match = sentencePattern.exec(searchRange)) !== null) {
      if (match.index > maxChars * 0.3) {
        lastSentenceEnd = match.index + match[0].length;
      }
    }
    if (lastSentenceEnd > maxChars * 0.3) return lastSentenceEnd;

    // Priority 4: Space (word boundary)
    const lastSpace = searchRange.lastIndexOf(' ');
    if (lastSpace > maxChars * 0.3) return lastSpace + 1;

    // Fallback: Hard split at maxChars
    return maxChars;
  }
}

// Singleton instance
export const messageFormatter = new MessageFormatter();
