'use client';

import { useState } from 'react';
import { deleteReminder, deleteTrigger, toggleTrigger } from '@/lib/api';
import { useToolDefinitions, useToolExecutions, useReminders, useTriggers } from '@/lib/hooks';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/Button';
import { Wrench, Play, Clock, Repeat, Trash2, ToggleLeft, ToggleRight, AlertCircle, CheckCircle } from 'lucide-react';

type Tab = 'tools' | 'executions' | 'reminders' | 'triggers';

export default function ToolsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('tools');

  const { data: defsData, isLoading: defsLoading } = useToolDefinitions();
  const { data: execsData, isLoading: execsLoading } = useToolExecutions();
  const { data: remindersData, isLoading: remindersLoading, mutate: mutateReminders } = useReminders();
  const { data: triggersData, isLoading: triggersLoading, mutate: mutateTriggers } = useTriggers();

  const definitions = defsData?.tools ?? [];
  const executions = execsData?.executions ?? [];
  const reminders = remindersData?.reminders ?? [];
  const triggers = triggersData?.triggers ?? [];

  const loading =
    (activeTab === 'tools' && defsLoading) ||
    (activeTab === 'executions' && execsLoading) ||
    (activeTab === 'reminders' && remindersLoading) ||
    (activeTab === 'triggers' && triggersLoading);

  const handleDeleteReminder = async (id: string) => {
    try {
      await deleteReminder(id);
      mutateReminders();
    } catch (err) {
      console.error('Failed to delete reminder:', err);
    }
  };

  const handleToggleTrigger = async (id: string) => {
    try {
      await toggleTrigger(id);
      mutateTriggers();
    } catch (err) {
      console.error('Failed to toggle trigger:', err);
    }
  };

  const handleDeleteTrigger = async (id: string) => {
    try {
      await deleteTrigger(id);
      mutateTriggers();
    } catch (err) {
      console.error('Failed to delete trigger:', err);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'tools', label: 'Tools', icon: <Wrench className="w-3.5 h-3.5" /> },
    { id: 'executions', label: 'Executions', icon: <Play className="w-3.5 h-3.5" /> },
    { id: 'reminders', label: 'Reminders', icon: <Clock className="w-3.5 h-3.5" /> },
    { id: 'triggers', label: 'Triggers', icon: <Repeat className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Tools"
        description="AI tool definitions, execution log, reminders, and triggers"
      />

      {/* Tabs */}
      <div className="flex gap-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
              activeTab === tab.id
                ? 'bg-[var(--color-brand)] text-white'
                : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <LoadingSpinner label="Loading..." />}

      {/* Tools Tab */}
      {!loading && activeTab === 'tools' && (
        <div className="space-y-2">
          {definitions.length === 0 && (
            <EmptyState
              icon={<Wrench className="w-10 h-10" />}
              title="No tools registered"
              description="Tools will appear here once the backend registers them."
            />
          )}
          {definitions.map((tool) => (
            <Card key={tool.name} padding="sm">
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  tool.type === 'anthropic_server'
                    ? 'bg-purple-100 dark:bg-purple-950/40'
                    : 'bg-blue-100 dark:bg-blue-950/40'
                }`}>
                  <Wrench className={`w-4 h-4 ${
                    tool.type === 'anthropic_server'
                      ? 'text-purple-600 dark:text-purple-400'
                      : 'text-blue-600 dark:text-blue-400'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[12px] font-semibold">{tool.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${
                      tool.type === 'anthropic_server'
                        ? 'bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400'
                        : 'bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                    }`}>
                      {tool.type === 'anthropic_server' ? 'Server' : 'Custom'}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                      tool.enabled
                        ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                        : 'bg-gray-100 dark:bg-gray-950/40 text-gray-500'
                    }`}>
                      {tool.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--color-text-tertiary)]">{tool.description}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Executions Tab */}
      {!loading && activeTab === 'executions' && (
        <div className="space-y-2">
          {executions.length === 0 && (
            <EmptyState
              icon={<Play className="w-10 h-10" />}
              title="No executions yet"
              description="Tool execution logs will appear here as the AI uses tools."
            />
          )}
          {executions.map((exec) => (
            <Card key={exec.id} padding="sm">
              <div className="flex items-start gap-3">
                {exec.isError ? (
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[12px] font-semibold">{exec.toolName}</span>
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">
                      {exec.durationMs}ms
                    </span>
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">
                      {exec.userId}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--color-text-secondary)] truncate">
                    {exec.output}
                  </p>
                </div>
                <time className="text-[10px] text-[var(--color-text-tertiary)] flex-shrink-0" dateTime={exec.createdAt}>
                  {new Date(exec.createdAt).toLocaleString()}
                </time>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Reminders Tab */}
      {!loading && activeTab === 'reminders' && (
        <div className="space-y-2">
          {reminders.length === 0 && (
            <EmptyState
              icon={<Clock className="w-10 h-10" />}
              title="No reminders"
              description="Reminders created by the AI will appear here."
            />
          )}
          {reminders.map((reminder) => {
            const isPast = new Date(reminder.due_at) <= new Date();
            return (
              <Card key={reminder.id} padding="sm">
                <div className="flex items-start gap-3">
                  <Clock className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                    reminder.is_sent ? 'text-gray-400' : isPast ? 'text-red-500' : 'text-blue-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-[var(--color-text-secondary)]">{reminder.message}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <time className="text-[10px] text-[var(--color-text-tertiary)]" dateTime={reminder.due_at}>
                        Due: {new Date(reminder.due_at).toLocaleString()}
                      </time>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                        reminder.is_sent
                          ? 'bg-gray-100 dark:bg-gray-950/40 text-gray-500'
                          : isPast
                            ? 'bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                            : 'bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                      }`}>
                        {reminder.is_sent ? 'Sent' : isPast ? 'Overdue' : 'Pending'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteReminder(reminder.id)}
                    className="p-1 rounded text-red-500 hover:bg-red-100 dark:hover:bg-red-950/40 transition-colors"
                    title="Delete reminder"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Triggers Tab */}
      {!loading && activeTab === 'triggers' && (
        <div className="space-y-2">
          {triggers.length === 0 && (
            <EmptyState
              icon={<Repeat className="w-10 h-10" />}
              title="No triggers"
              description="Recurring triggers created by the AI will appear here."
            />
          )}
          {triggers.map((trigger) => (
            <Card key={trigger.id} padding="sm">
              <div className="flex items-start gap-3">
                <Repeat className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                  trigger.is_active ? 'text-emerald-500' : 'text-gray-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[12px] font-semibold">{trigger.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                      trigger.is_active
                        ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                        : 'bg-gray-100 dark:bg-gray-950/40 text-gray-500'
                    }`}>
                      {trigger.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--color-text-secondary)]">{trigger.message}</p>
                  <p className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
                    Schedule: {trigger.schedule}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleToggleTrigger(trigger.id)}
                    className="p-1 rounded hover:bg-[var(--color-bg-tertiary)] transition-colors"
                    title={trigger.is_active ? 'Deactivate' : 'Activate'}
                  >
                    {trigger.is_active ? (
                      <ToggleRight className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <ToggleLeft className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                  <button
                    onClick={() => handleDeleteTrigger(trigger.id)}
                    className="p-1 rounded text-red-500 hover:bg-red-100 dark:hover:bg-red-950/40 transition-colors"
                    title="Delete trigger"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
