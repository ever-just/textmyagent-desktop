'use client';

import { useState } from 'react';
import { useAgentStatus, useStatus, useConfig } from '@/lib/hooks';
import { startAgent, stopAgent, restartAgent } from '@/lib/api';
import { Card, StatCard } from '@/components/Card';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import {
  Play,
  Square,
  RotateCcw,
  MessageSquare,
  Users,
  Zap,
  Database,
  Cpu,
  Coins,
  Brain,
} from 'lucide-react';

export default function DashboardPage() {
  const { data: agent, error: agentError, mutate: mutateAgent } = useAgentStatus();
  const { data: status, error: statusError } = useStatus();
  const { data: config } = useConfig();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleAgentAction = async (action: 'start' | 'stop' | 'restart') => {
    setActionLoading(action);
    setActionError(null);
    try {
      const fn = action === 'start' ? startAgent : action === 'stop' ? stopAgent : restartAgent;
      const result = await fn();
      if (!result.success) {
        setActionError(result.error || `Failed to ${action} agent`);
      }
      await mutateAgent();
    } catch (err: any) {
      setActionError(err.message || `Failed to ${action} agent`);
    } finally {
      setActionLoading(null);
    }
  };

  if (agentError || statusError) {
    return (
      <div className="p-6">
        <PageHeader title="Dashboard" />
        <Card className="border-red-200 dark:border-red-900">
          <div className="flex items-center gap-3 text-red-600 dark:text-red-400" role="alert">
            <Zap className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Unable to connect to backend</p>
              <p className="text-[13px] mt-0.5 text-[var(--color-text-secondary)]">
                The backend server may not be running. Please restart the application.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-6">
        <PageHeader title="Dashboard" />
        <LoadingSpinner label="Connecting to backend..." />
      </div>
    );
  }

  const isRunning = agent.isRunning;
  const isConnected = agent.isConnected;

  return (
    <div className="p-6">
      <PageHeader
        title="Dashboard"
        description="Monitor and control your AI messaging agent"
        actions={
          <div className="flex items-center gap-2">
            {isRunning ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                  loading={actionLoading === 'restart'}
                  onClick={() => handleAgentAction('restart')}
                  aria-label="Restart agent"
                >
                  Restart
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  icon={<Square className="w-3.5 h-3.5" />}
                  loading={actionLoading === 'stop'}
                  onClick={() => handleAgentAction('stop')}
                  aria-label="Stop agent"
                >
                  Stop Agent
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                size="sm"
                icon={<Play className="w-3.5 h-3.5" />}
                loading={actionLoading === 'start'}
                onClick={() => handleAgentAction('start')}
                aria-label="Start agent"
              >
                Start Agent
              </Button>
            )}
          </div>
        }
      />

      {/* Error alert */}
      {actionError && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800" role="alert">
          <p className="text-[13px] text-red-700 dark:text-red-400">{actionError}</p>
        </div>
      )}

      {/* Agent Status Card */}
      <Card className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isRunning ? 'bg-emerald-100 dark:bg-emerald-950/40' : 'bg-gray-100 dark:bg-gray-800'
            }`}>
              <Cpu className={`w-6 h-6 ${isRunning ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`} aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Agent Status</h2>
              <p className="text-[13px] text-[var(--color-text-secondary)] mt-0.5">
                {isRunning
                  ? isConnected
                    ? 'Actively monitoring and responding to iMessages'
                    : 'Running but not connected to iMessage'
                  : 'Agent is stopped. Start it to begin responding to messages.'}
              </p>
            </div>
          </div>
          <StatusBadge status={isRunning ? 'running' : 'stopped'} size="md" />
        </div>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Active Conversations"
          value={agent.activeConversations}
          subtitle="In memory"
          icon={<MessageSquare className="w-5 h-5" />}
        />
        <StatCard
          label="Processing"
          value={agent.processingCount}
          subtitle="Messages in queue"
          icon={<Zap className="w-5 h-5" />}
        />
        <StatCard
          label="iMessage"
          value={isConnected ? 'Connected' : 'Disconnected'}
          subtitle={isConnected ? 'Polling active' : 'Not polling'}
          icon={<MessageSquare className="w-5 h-5" />}
        />
      </div>

      {/* Budget + Memory Widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <Coins className="w-5 h-5 text-amber-500" aria-hidden="true" />
            <h3 className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">Daily Budget</h3>
          </div>
          {(() => {
            const budgetCents = config?.settings?.['security.dailyBudgetCents'] || 0;
            if (!budgetCents || budgetCents <= 0) {
              return <p className="text-[13px] text-[var(--color-text-secondary)]">No daily budget limit set</p>;
            }
            const budgetDollars = budgetCents / 100;
            return (
              <div>
                <p className="text-xl font-semibold">${budgetDollars.toFixed(2)} <span className="text-[13px] font-normal text-[var(--color-text-secondary)]">/ day</span></p>
                <p className="text-[12px] text-[var(--color-text-tertiary)] mt-1">
                  Agent will stop responding when budget is exceeded
                </p>
              </div>
            );
          })()}
        </Card>
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <Brain className="w-5 h-5 text-purple-500" aria-hidden="true" />
            <h3 className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">Memory</h3>
          </div>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {config?.settings?.['memory.maxFactsPerUser'] || 50} facts per user limit
            {config?.settings?.['memory.factTTLDays'] ? ` · ${config.settings['memory.factTTLDays']}d TTL` : ''}
          </p>
          <p className="text-[12px] text-[var(--color-text-tertiary)] mt-1">
            {config?.settings?.['memory.enableSummarization'] ? 'Summarization enabled' : 'Summarization disabled'}
          </p>
        </Card>
      </div>

      {/* System Info */}
      <Card>
        <h3 className="text-[13px] font-semibold mb-3 text-[var(--color-text-secondary)] uppercase tracking-wide">System Information</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Version', value: status?.agent?.version || config?.app?.version || '—' },
            { label: 'Model', value: config?.model?.name || 'Gemma 4 E4B' },
            { label: 'Platform', value: config?.app?.platform || '—' },
            { label: 'Inference', value: 'Local (on-device)' },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">{label}</p>
              <p className="text-[13px] font-medium mt-0.5 truncate">{value}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
