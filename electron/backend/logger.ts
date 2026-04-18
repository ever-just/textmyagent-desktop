import { Response } from 'express';
import type { SecuritySeverity } from './types';

// P0.4: Lazy-load electron-log so unit tests (which import logger without a
// running Electron app) don't blow up. The main process calls log.initialize()
// in main.ts before anything imports this module.
let _elog: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  _elog = require('electron-log');
} catch {
  _elog = null;
}

// In-memory log buffer (extracted to break circular dependency — fixes E1)
export interface LogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  metadata?: Record<string, any>;
}

class LogBuffer {
  private buffer: LogEntry[] = [];
  private head = 0;
  private count = 0;
  private maxSize = 500;

  add(entry: LogEntry) {
    if (this.count < this.maxSize) {
      this.buffer.push(entry);
      this.count++;
    } else {
      this.buffer[this.head] = entry;
    }
    this.head = (this.head + 1) % this.maxSize;
  }

  query(filters: { level?: string; search?: string; limit?: number }): LogEntry[] {
    // Build ordered array from circular buffer (newest first)
    const ordered: LogEntry[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - 1 - i + this.maxSize) % this.maxSize;
      ordered.push(this.buffer[idx]);
    }

    let result = ordered;

    if (filters.level && filters.level !== 'all') {
      result = result.filter((log) => log.level === filters.level);
    }

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter(
        (log) =>
          log.message.toLowerCase().includes(searchLower) ||
          JSON.stringify(log.metadata || {}).toLowerCase().includes(searchLower)
      );
    }

    if (filters.limit) {
      result = result.slice(0, filters.limit);
    }

    return result;
  }
}

export const logBuffer = new LogBuffer();

// SSE log stream subscribers
export const logSubscribers: Set<Response> = new Set();

// Log helper
export function log(
  level: 'error' | 'warn' | 'info' | 'debug',
  message: string,
  metadata?: Record<string, any>
) {
  const entry: LogEntry = { timestamp: new Date().toISOString(), level, message, metadata };
  logBuffer.add(entry);
  console.log(`[${level.toUpperCase()}] ${message}`, metadata || '');

  // P0.4: forward to electron-log file transport when available (production).
  // Tests don't bundle electron-log, so _elog is null and this is a no-op.
  if (_elog) {
    try {
      const fn = _elog[level] || _elog.info;
      if (typeof fn === 'function') {
        fn(message, metadata ? JSON.stringify(metadata) : '');
      }
    } catch {
      // Never let file-log failures break the caller.
    }
  }

  // Broadcast to SSE subscribers
  if (logSubscribers.size > 0) {
    const msg = `data: ${JSON.stringify(entry)}\n\n`;
    logSubscribers.forEach((client) => {
      try {
        client.write(msg);
      } catch {
        logSubscribers.delete(client);
      }
    });
  }
}

/**
 * Log a security event to both in-memory buffer (SSE) and persistent security_events table.
 * Phase 1, task 1.8: Dual-write security event logger.
 */
export function logSecurityEvent(
  eventType: string,
  userHandle: string | null,
  details: Record<string, unknown> = {},
  severity: SecuritySeverity = 'low'
): void {
  // Write to in-memory log buffer + SSE
  const levelMap: Record<SecuritySeverity, 'error' | 'warn' | 'info'> = {
    critical: 'error',
    high: 'error',
    medium: 'warn',
    low: 'info',
  };
  log(levelMap[severity], `[SECURITY] ${eventType}`, { userHandle, severity, ...details });

  // Persist to security_events table
  try {
    // Lazy import to avoid circular dependency (database imports logger)
    const { getDatabase } = require('./database');
    const db = getDatabase();
    db.prepare(
      `INSERT INTO security_events (event_type, user_handle, details, severity) VALUES (?, ?, ?, ?)`
    ).run(eventType, userHandle, JSON.stringify(details), severity);
  } catch (error) {
    // Don't let persistence failure break the calling code
    console.error('[Security] Failed to persist security event:', error);
  }
}
