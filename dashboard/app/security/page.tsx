'use client';

import { useState } from 'react';
import { useSecurityEvents, useSecurityConfig, useBudgetStatus, useBlockedUsers } from '@/lib/hooks';
import { unblockUser, updateConfig } from '@/lib/api';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/Button';
import { Shield, AlertTriangle, DollarSign, UserX, Zap } from 'lucide-react';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-950/40',
  high: 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-950/40',
  medium: 'text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-950/40',
  low: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-950/40',
};

export default function SecurityPage() {
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const { data: eventsData, isLoading: eventsLoading } = useSecurityEvents(severityFilter);
  const { data: config } = useSecurityConfig();
  const { data: budget } = useBudgetStatus();
  const { data: blockedData, mutate: mutateBlocked } = useBlockedUsers();

  const handleUnblock = async (userId: string) => {
    try {
      await unblockUser(userId);
      mutateBlocked();
    } catch (err) {
      console.error('Failed to unblock user:', err);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Security"
        description="Rate limits, budget controls, and security event monitoring"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Budget Card */}
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-[13px] font-semibold">Daily Budget</p>
              <p className="text-[11px] text-[var(--color-text-tertiary)]">
                {budget?.dailyBudgetCents ? `$${(budget.dailyBudgetCents / 100).toFixed(2)} limit` : 'No limit set'}
              </p>
            </div>
          </div>
          {budget && budget.dailyBudgetCents > 0 && (
            <div>
              <div className="flex justify-between text-[12px] mb-1">
                <span className="text-[var(--color-text-secondary)]">
                  ${(budget.spentCents / 100).toFixed(4)} spent
                </span>
                <span className={budget.isExceeded ? 'text-red-500 font-semibold' : 'text-[var(--color-text-tertiary)]'}>
                  {budget.percentUsed}%
                </span>
              </div>
              <div className="h-2 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    budget.isExceeded ? 'bg-red-500' : budget.percentUsed > 80 ? 'bg-yellow-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, budget.percentUsed)}%` }}
                />
              </div>
            </div>
          )}
          {budget && budget.dailyBudgetCents === 0 && (
            <p className="text-[12px] text-[var(--color-text-tertiary)]">
              {budget.inputTokens.toLocaleString()} input + {budget.outputTokens.toLocaleString()} output tokens today
            </p>
          )}
        </Card>

        {/* Rate Limits Card */}
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
              <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-[13px] font-semibold">Rate Limits</p>
              <p className="text-[11px] text-[var(--color-text-tertiary)]">Per-user & global</p>
            </div>
          </div>
          <div className="space-y-1 text-[12px] text-[var(--color-text-secondary)]">
            <p>{config?.rateLimitPerMinute ?? 10} msgs/min per user</p>
            <p>{config?.rateLimitGlobalPerHour ?? 200} msgs/hour global</p>
            <p>{config?.maxApiCallsPerMessage ?? 6} API calls/message max</p>
          </div>
        </Card>

        {/* Blocked Users Card */}
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-red-100 dark:bg-red-950/40 flex items-center justify-center">
              <UserX className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-[13px] font-semibold">Blocked Users</p>
              <p className="text-[11px] text-[var(--color-text-tertiary)]">
                {blockedData?.users.length ?? 0} blocked
              </p>
            </div>
          </div>
          {blockedData && blockedData.users.length > 0 ? (
            <div className="space-y-1.5">
              {blockedData.users.slice(0, 5).map((user) => (
                <div key={user.id} className="flex items-center justify-between">
                  <span className="text-[12px] text-[var(--color-text-secondary)] truncate">
                    {user.displayName || user.handle}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => handleUnblock(user.id)}>
                    Unblock
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-[var(--color-text-tertiary)]">No blocked users</p>
          )}
        </Card>
      </div>

      {/* Security Events */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-semibold">Security Events</h2>
          <div className="flex gap-1.5">
            {['all', 'critical', 'high', 'medium', 'low'].map((s) => (
              <button
                key={s}
                onClick={() => setSeverityFilter(s)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  severityFilter === s
                    ? 'bg-[var(--color-brand)] text-white'
                    : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {eventsLoading && <LoadingSpinner label="Loading events..." />}

        {eventsData && eventsData.events.length === 0 && (
          <EmptyState
            icon={<Shield className="w-10 h-10" />}
            title="No security events"
            description="Security events will appear here when rate limits are hit, budget is exceeded, or content filters trigger."
          />
        )}

        {eventsData && eventsData.events.length > 0 && (
          <div className="space-y-2">
            {eventsData.events.map((event) => (
              <Card key={event.id} padding="sm">
                <div className="flex items-start gap-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${SEVERITY_COLORS[event.severity] || SEVERITY_COLORS.low}`}>
                    {event.severity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[12px] font-semibold">{event.eventType}</span>
                      {event.userHandle && (
                        <span className="text-[11px] text-[var(--color-text-tertiary)]">
                          {event.userHandle}
                        </span>
                      )}
                    </div>
                    {event.details && Object.keys(event.details).length > 0 && (
                      <p className="text-[11px] text-[var(--color-text-tertiary)] truncate">
                        {JSON.stringify(event.details)}
                      </p>
                    )}
                  </div>
                  <time className="text-[11px] text-[var(--color-text-tertiary)] flex-shrink-0" dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleString()}
                  </time>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
