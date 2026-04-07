import { Response } from 'express';

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
