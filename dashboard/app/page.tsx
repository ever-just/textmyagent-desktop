'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAgentStatus, useStatus, useConfig } from '@/lib/hooks';
import { startAgent, stopAgent, restartAgent, updateConfig, importContacts, MacContact } from '@/lib/api';
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
  Shield,
  UserPlus,
  X,
  Search,
  Check,
  Loader2,
} from 'lucide-react';

export default function DashboardPage() {
  const { data: agent, error: agentError, mutate: mutateAgent } = useAgentStatus();
  const { data: status, error: statusError } = useStatus();
  const { data: config, mutate: mutateConfig } = useConfig();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Reply mode state
  const [replyMode, setReplyMode] = useState<'everyone' | 'allowlist'>('everyone');
  const [allowedContacts, setAllowedContacts] = useState<string[]>([]);
  const [replyModeSaving, setReplyModeSaving] = useState(false);
  const [replyModeSaved, setReplyModeSaved] = useState(false);

  // Contact picker state
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [macContacts, setMacContacts] = useState<MacContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState('');

  // Sync reply mode from config
  useEffect(() => {
    if (config?.settings) {
      setReplyMode(config.settings['agent.replyMode'] ?? 'everyone');
      setAllowedContacts(config.settings['agent.allowedContacts'] ?? []);
    }
  }, [config]);

  const saveReplyMode = useCallback(async (mode: 'everyone' | 'allowlist', contacts: string[]) => {
    setReplyModeSaving(true);
    try {
      await updateConfig({ 'agent.replyMode': mode, 'agent.allowedContacts': contacts });
      await mutateConfig();
      setReplyModeSaved(true);
      setTimeout(() => setReplyModeSaved(false), 2000);
    } catch { /* ignore */ }
    setReplyModeSaving(false);
  }, [mutateConfig]);

  const handleToggleReplyMode = useCallback(async () => {
    const newMode = replyMode === 'everyone' ? 'allowlist' : 'everyone';
    setReplyMode(newMode);
    await saveReplyMode(newMode, allowedContacts);
  }, [replyMode, allowedContacts, saveReplyMode]);

  const handleRemoveContact = useCallback(async (phone: string) => {
    const updated = allowedContacts.filter(c => c !== phone);
    setAllowedContacts(updated);
    await saveReplyMode(replyMode, updated);
  }, [allowedContacts, replyMode, saveReplyMode]);

  const handleAddContact = useCallback(async (phone: string) => {
    if (allowedContacts.includes(phone)) return;
    const updated = [...allowedContacts, phone];
    setAllowedContacts(updated);
    await saveReplyMode(replyMode, updated);
  }, [allowedContacts, replyMode, saveReplyMode]);

  const openContactPicker = useCallback(async () => {
    setShowContactPicker(true);
    setContactsLoading(true);
    try {
      const result = await importContacts();
      if (Array.isArray(result)) {
        setMacContacts(result.filter(c => c.phoneNumbers?.length > 0));
      }
    } catch { /* ignore */ }
    setContactsLoading(false);
  }, []);

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

      {/* Reply Mode Toggle + Contact Selector */}
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-blue-500" aria-hidden="true" />
            <h3 className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">Reply Mode</h3>
          </div>
          <div className="flex items-center gap-2">
            {replyModeSaving && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-text-tertiary)]" />}
            {replyModeSaved && <Check className="w-3.5 h-3.5 text-emerald-500" />}
            <button
              onClick={handleToggleReplyMode}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                replyMode === 'allowlist' ? 'bg-[var(--color-brand)]' : 'bg-gray-300 dark:bg-gray-600'
              }`}
              role="switch"
              aria-checked={replyMode === 'allowlist'}
              aria-label="Toggle reply mode"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  replyMode === 'allowlist' ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
        <p className="text-[13px] text-[var(--color-text-secondary)] mb-3">
          {replyMode === 'everyone'
            ? 'Agent responds to all incoming messages'
            : `Agent responds only to ${allowedContacts.length} selected contact${allowedContacts.length !== 1 ? 's' : ''}`
          }
        </p>

        {replyMode === 'allowlist' && (
          <div className="border-t border-[var(--color-border)] pt-3">
            {/* Allowed contacts list */}
            {allowedContacts.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {allowedContacts.map((phone) => (
                  <div key={phone} className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-[var(--color-bg-tertiary)]">
                    <span className="text-[12px] font-mono text-[var(--color-text-secondary)]">{phone}</span>
                    <button
                      onClick={() => handleRemoveContact(phone)}
                      className="text-[var(--color-text-tertiary)] hover:text-red-500 transition-colors p-0.5"
                      aria-label={`Remove ${phone}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add contact button */}
            <Button
              variant="secondary"
              size="sm"
              icon={<UserPlus className="w-3.5 h-3.5" />}
              onClick={openContactPicker}
            >
              Add from Contacts
            </Button>

            {/* Contact picker modal */}
            {showContactPicker && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowContactPicker(false)}>
                <div
                  className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl shadow-xl w-full max-w-md max-h-[70vh] flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
                    <h3 className="text-[14px] font-semibold">Select Contacts</h3>
                    <button onClick={() => setShowContactPicker(false)} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="px-4 pt-3 pb-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-tertiary)]" />
                      <input
                        type="text"
                        placeholder="Search contacts..."
                        value={contactSearch}
                        onChange={(e) => setContactSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)] outline-none"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 pb-4">
                    {contactsLoading && <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-[var(--color-text-tertiary)]" /></div>}
                    {!contactsLoading && macContacts.length === 0 && (
                      <p className="py-8 text-center text-[12px] text-[var(--color-text-tertiary)]">No contacts with phone numbers found. Make sure Contacts permission is granted.</p>
                    )}
                    {!contactsLoading && macContacts
                      .filter(c => {
                        if (!contactSearch) return true;
                        const q = contactSearch.toLowerCase();
                        return (c.firstName + ' ' + c.lastName).toLowerCase().includes(q) || c.phoneNumbers.some(p => p.includes(contactSearch));
                      })
                      .slice(0, 50)
                      .map((contact) => {
                        const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown';
                        return contact.phoneNumbers.map((phone) => {
                          const isAdded = allowedContacts.some(ac => {
                            const acDigits = ac.replace(/\D/g, '').slice(-10);
                            const phoneDigits = phone.replace(/\D/g, '').slice(-10);
                            return acDigits === phoneDigits;
                          });
                          return (
                            <button
                              key={`${contact.id}-${phone}`}
                              onClick={() => {
                                if (!isAdded) handleAddContact(phone);
                              }}
                              disabled={isAdded}
                              className={`w-full flex items-center justify-between py-2 px-2.5 rounded-lg text-left transition-colors ${
                                isAdded ? 'opacity-50 cursor-default' : 'hover:bg-[var(--color-bg-tertiary)] cursor-pointer'
                              }`}
                            >
                              <div>
                                <p className="text-[13px] font-medium">{name}</p>
                                <p className="text-[11px] text-[var(--color-text-tertiary)] font-mono">{phone}</p>
                              </div>
                              {isAdded && <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                            </button>
                          );
                        });
                      })
                    }
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

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
