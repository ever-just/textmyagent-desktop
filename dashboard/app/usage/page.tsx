'use client';

import { useState } from 'react';
import { useUsage, useConfig } from '@/lib/hooks';
import { Card, StatCard } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { BarChart3, Coins, Zap, Hash } from 'lucide-react';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Local model — no API cost
function estimateCost(_inputTokens: number, _outputTokens: number, _model?: string): string {
  return '$0.00 (local)';
}

export default function UsagePage() {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const { data, error, isLoading } = useUsage(period);
  const { data: config } = useConfig();
  const currentModel = config?.model?.name || 'Gemma 4 E4B';

  return (
    <div className="p-6">
      <PageHeader
        title="Usage"
        description="Track your AI agent's API token usage and estimated costs"
        actions={
          <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden" role="radiogroup" aria-label="Usage period">
            {(['day', 'week', 'month'] as const).map((p) => (
              <button
                key={p}
                role="radio"
                aria-checked={period === p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-[12px] font-medium capitalize transition-colors ${
                  period === p
                    ? 'bg-[var(--color-brand)] text-white'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]'
                }`}
              >
                {p === 'day' ? 'Daily' : p === 'week' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <Card className="border-red-200 dark:border-red-900 mb-4">
          <p className="text-[13px] text-red-600 dark:text-red-400" role="alert">
            Failed to load usage data.
          </p>
        </Card>
      )}

      {isLoading && <LoadingSpinner label="Loading usage data..." />}

      {data && (
        <>
          {/* Totals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Total Tokens"
              value={formatTokens(data.totals.totalTokens)}
              subtitle={`${formatTokens(data.totals.inputTokens)} in / ${formatTokens(data.totals.outputTokens)} out`}
              icon={<Zap className="w-5 h-5" />}
            />
            <StatCard
              label="Requests"
              value={data.totals.requestCount}
              subtitle="API calls"
              icon={<Hash className="w-5 h-5" />}
            />
            <StatCard
              label="Estimated Cost"
              value={estimateCost(data.totals.inputTokens, data.totals.outputTokens, currentModel)}
              subtitle="Local inference — no API cost"
              icon={<Coins className="w-5 h-5" />}
            />
            <StatCard
              label="Avg per Request"
              value={data.totals.requestCount > 0
                ? formatTokens(Math.round(data.totals.totalTokens / data.totals.requestCount))
                : '—'}
              subtitle="Tokens per request"
              icon={<BarChart3 className="w-5 h-5" />}
            />
          </div>

          {/* Usage breakdown */}
          {data.usage.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="w-10 h-10" />}
              title="No usage data yet"
              description="Usage will be tracked once the agent starts processing messages."
            />
          ) : (
            <Card>
              <h3 className="text-[13px] font-semibold mb-3 text-[var(--color-text-secondary)] uppercase tracking-wide">
                Breakdown by {period === 'day' ? 'Day' : period === 'week' ? 'Week' : 'Month'}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]" role="table">
                  <thead>
                    <tr className="border-b border-[var(--color-border)]">
                      <th className="text-left py-2 pr-4 font-medium text-[var(--color-text-secondary)]">Period</th>
                      <th className="text-right py-2 px-4 font-medium text-[var(--color-text-secondary)]">Input</th>
                      <th className="text-right py-2 px-4 font-medium text-[var(--color-text-secondary)]">Output</th>
                      <th className="text-right py-2 px-4 font-medium text-[var(--color-text-secondary)]">Total</th>
                      <th className="text-right py-2 px-4 font-medium text-[var(--color-text-secondary)]">Requests</th>
                      <th className="text-right py-2 pl-4 font-medium text-[var(--color-text-secondary)]">Est. Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.usage.map((row) => (
                      <tr key={row.period} className="border-b border-[var(--color-border-light)] hover:bg-[var(--color-bg-secondary)]">
                        <td className="py-2 pr-4 font-medium">{row.period}</td>
                        <td className="py-2 px-4 text-right font-mono text-[var(--color-text-secondary)]">{formatTokens(row.inputTokens)}</td>
                        <td className="py-2 px-4 text-right font-mono text-[var(--color-text-secondary)]">{formatTokens(row.outputTokens)}</td>
                        <td className="py-2 px-4 text-right font-mono font-medium">{formatTokens(row.totalTokens)}</td>
                        <td className="py-2 px-4 text-right font-mono text-[var(--color-text-secondary)]">{row.requestCount}</td>
                        <td className="py-2 pl-4 text-right font-mono text-[var(--color-text-secondary)]">{estimateCost(row.inputTokens, row.outputTokens, currentModel)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
