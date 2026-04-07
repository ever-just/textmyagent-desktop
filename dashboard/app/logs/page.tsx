'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLogs } from '@/lib/hooks';
import { createLogStream, LogEntry } from '@/lib/api';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/Button';
import { ScrollText, Pause, Play, Trash2, Search } from 'lucide-react';

const LEVEL_COLORS: Record<string, string> = {
  error: 'text-red-600 dark:text-red-400',
  warn: 'text-amber-600 dark:text-amber-400',
  info: 'text-blue-600 dark:text-blue-400',
  debug: 'text-gray-500 dark:text-gray-500',
};

const LEVEL_BG: Record<string, string> = {
  error: 'bg-red-50 dark:bg-red-950/20',
  warn: 'bg-amber-50 dark:bg-amber-950/20',
  info: '',
  debug: '',
};

export default function LogsPage() {
  const [level, setLevel] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [streaming, setStreaming] = useState(true);
  const [streamLogs, setStreamLogs] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [reconnectKey, setReconnectKey] = useState(0);

  // Debounce search input
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: initialLogs, isLoading } = useLogs(
    level !== 'all' ? level : undefined,
    debouncedSearch || undefined
  );

  // SSE streaming
  useEffect(() => {
    if (!streaming) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    const es = createLogStream(
      (entry) => {
        setStreamLogs((prev) => {
          const next = [...prev, entry];
          return next.length > 500 ? next.slice(-500) : next;
        });
      },
      () => {
        // Reconnect on error after delay by bumping the key
        esRef.current?.close();
        esRef.current = null;
        setTimeout(() => setReconnectKey((k) => k + 1), 3000);
      }
    );
    esRef.current = es;

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [streaming, reconnectKey]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamLogs, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  }, []);

  // Merge initial + stream logs
  const allLogs = [
    ...(initialLogs?.logs || []),
    ...streamLogs,
  ].filter((log) => {
    if (level !== 'all' && log.level !== level) return false;
    if (search && !log.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6 flex flex-col h-[calc(100vh-38px)]">
      <PageHeader
        title="Logs"
        description="Real-time application logs"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={streaming ? 'secondary' : 'primary'}
              size="sm"
              icon={streaming ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              onClick={() => setStreaming(!streaming)}
              aria-label={streaming ? 'Pause log stream' : 'Resume log stream'}
            >
              {streaming ? 'Pause' : 'Resume'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={() => setStreamLogs([])}
              aria-label="Clear logs"
            >
              Clear
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          <input
            type="search"
            placeholder="Filter logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)] outline-none"
            aria-label="Search logs"
          />
        </div>
        <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden" role="radiogroup" aria-label="Log level filter">
          {['all', 'error', 'warn', 'info', 'debug'].map((l) => (
            <button
              key={l}
              role="radio"
              aria-checked={level === l}
              onClick={() => setLevel(l)}
              className={`px-3 py-1.5 text-[12px] font-medium capitalize transition-colors ${
                level === l
                  ? 'bg-[var(--color-brand)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Log output */}
      {isLoading && allLogs.length === 0 && <LoadingSpinner label="Loading logs..." />}

      {!isLoading && allLogs.length === 0 && (
        <EmptyState
          icon={<ScrollText className="w-10 h-10" />}
          title="No logs"
          description={search ? 'No logs match your filter.' : 'Logs will appear here when the agent is active.'}
        />
      )}

      {allLogs.length > 0 && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] font-mono text-[12px]"
          role="log"
          aria-live="polite"
          aria-label="Application log stream"
        >
          {allLogs.map((log, i) => (
            <div
              key={`${log.timestamp}-${i}`}
              className={`flex items-start gap-3 px-3 py-1.5 border-b border-[var(--color-border-light)] ${LEVEL_BG[log.level] || ''}`}
            >
              <time className="text-[var(--color-text-tertiary)] flex-shrink-0 w-[180px]" dateTime={log.timestamp}>
                {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })}
              </time>
              <span className={`uppercase font-semibold flex-shrink-0 w-[48px] ${LEVEL_COLORS[log.level] || ''}`}>
                {log.level}
              </span>
              <span className="text-[var(--color-text)] break-words min-w-0">{log.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Stream indicator */}
      {streaming && (
        <div className="flex items-center gap-2 mt-2 text-[11px] text-[var(--color-text-tertiary)]">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
          Live streaming • {allLogs.length} entries
          {!autoScroll && (
            <button
              className="ml-2 text-[var(--color-brand)] hover:underline"
              onClick={() => {
                setAutoScroll(true);
                scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
              }}
            >
              ↓ Scroll to bottom
            </button>
          )}
        </div>
      )}
    </div>
  );
}
