'use client';

import { useState, useCallback } from 'react';
import { useMemoryStats, useUsers } from '@/lib/hooks';
import { getUserFacts, deleteFact, purgeUserFacts, expireOldFacts } from '@/lib/api';
import type { UserFact } from '@/lib/api';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/Button';
import { Brain, Database, Trash2, Download, User, Tag, CheckCircle } from 'lucide-react';

const FACT_TYPE_COLORS: Record<string, string> = {
  preference: 'text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-950/40',
  personal: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-950/40',
  behavioral: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40',
  general: 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-950/40',
};

export default function MemoryPage() {
  const { data: stats, isLoading: statsLoading, mutate: mutateStats } = useMemoryStats();
  const { data: usersData } = useUsers();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [facts, setFacts] = useState<UserFact[]>([]);
  const [factsLoading, setFactsLoading] = useState(false);

  const loadFacts = async (userId: string) => {
    setSelectedUserId(userId);
    setFactsLoading(true);
    try {
      const result = await getUserFacts(userId);
      setFacts(result.facts);
    } catch (err) {
      console.error('Failed to load facts:', err);
      setFacts([]);
    } finally {
      setFactsLoading(false);
    }
  };

  const handleDeleteFact = async (factId: string) => {
    try {
      await deleteFact(factId);
      setFacts((prev) => prev.filter((f) => f.id !== factId));
      mutateStats();
    } catch (err) {
      console.error('Failed to delete fact:', err);
    }
  };

  const handlePurge = async (userId: string) => {
    if (!confirm('Are you sure you want to delete all facts for this user?')) return;
    try {
      await purgeUserFacts(userId);
      setFacts([]);
      mutateStats();
    } catch (err) {
      console.error('Failed to purge facts:', err);
    }
  };

  const [expireMessage, setExpireMessage] = useState<string | null>(null);

  const handleExpire = async () => {
    try {
      const result = await expireOldFacts();
      setExpireMessage(`Expired ${result.expiredCount} old facts.`);
      setTimeout(() => setExpireMessage(null), 3000);
      mutateStats();
      if (selectedUserId) loadFacts(selectedUserId);
    } catch (err) {
      console.error('Failed to expire facts:', err);
      setExpireMessage('Failed to expire facts.');
      setTimeout(() => setExpireMessage(null), 3000);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Memory"
        description="User facts, conversation summaries, and knowledge management"
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-950/40 flex items-center justify-center">
              <Brain className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-[20px] font-bold">{stats?.totalFacts ?? 0}</p>
              <p className="text-[11px] text-[var(--color-text-tertiary)]">Total Facts</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
              <User className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-[20px] font-bold">{stats?.userCount ?? 0}</p>
              <p className="text-[11px] text-[var(--color-text-tertiary)]">Users with Facts</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center">
              <Database className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-[20px] font-bold">{stats?.totalSummaries ?? 0}</p>
              <p className="text-[11px] text-[var(--color-text-tertiary)]">Summaries</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleExpire}>
              Expire Old Facts
            </Button>
            {expireMessage && (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> {expireMessage}
              </span>
            )}
          </div>
        </Card>
      </div>

      {/* Facts by Type */}
      {stats && stats.totalFacts > 0 && (
        <Card>
          <h3 className="text-[13px] font-semibold mb-2">Facts by Type</h3>
          <div className="flex gap-3 flex-wrap">
            {Object.entries(stats.factsByType).map(([type, count]) => (
              <span
                key={type}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium ${FACT_TYPE_COLORS[type] || FACT_TYPE_COLORS.general}`}
              >
                <Tag className="w-3 h-3" />
                {type}: {count}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* User Selector + Facts View */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* User List */}
        <div className="space-y-2">
          <h3 className="text-[13px] font-semibold mb-2">Select User</h3>
          {usersData?.users.map((user) => (
            <button
              key={user.id}
              onClick={() => loadFacts(user.handle)}
              className="w-full text-left"
            >
              <Card
                padding="sm"
                className={`transition-colors cursor-pointer ${
                  selectedUserId === user.handle
                    ? 'border-[var(--color-brand)]'
                    : 'hover:border-[var(--color-brand)]'
                }`}
              >
                <p className="text-[12px] font-medium truncate">{user.displayName || user.handle}</p>
                <p className="text-[11px] text-[var(--color-text-tertiary)] truncate">{user.handle}</p>
              </Card>
            </button>
          ))}
          {(!usersData || usersData.users.length === 0) && (
            <p className="text-[12px] text-[var(--color-text-tertiary)]">No users yet</p>
          )}
        </div>

        {/* Facts List */}
        <div className="md:col-span-2 space-y-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[13px] font-semibold">
              {selectedUserId ? `Facts for ${selectedUserId}` : 'Select a user to view facts'}
            </h3>
            {selectedUserId && facts.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => handlePurge(selectedUserId)}
              >
                Purge All
              </Button>
            )}
          </div>

          {factsLoading && <LoadingSpinner label="Loading facts..." />}

          {!factsLoading && selectedUserId && facts.length === 0 && (
            <EmptyState
              icon={<Brain className="w-10 h-10" />}
              title="No facts stored"
              description="Facts about this user will appear here as the AI learns from conversations."
            />
          )}

          {!factsLoading && facts.length > 0 && (
            <div className="space-y-2">
              {facts.map((fact) => (
                <Card key={fact.id} padding="sm">
                  <div className="flex items-start gap-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${FACT_TYPE_COLORS[fact.type] || FACT_TYPE_COLORS.general}`}>
                      {fact.type}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-[var(--color-text-secondary)]">{fact.content}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] text-[var(--color-text-tertiary)]">
                          Source: {fact.source}
                        </span>
                        <span className="text-[10px] text-[var(--color-text-tertiary)]">
                          Confidence: {Math.round(fact.confidence * 100)}%
                        </span>
                        <time className="text-[10px] text-[var(--color-text-tertiary)]" dateTime={fact.createdAt}>
                          {new Date(fact.createdAt).toLocaleDateString()}
                        </time>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteFact(fact.id)}
                      className="p-1 rounded text-red-500 hover:bg-red-100 dark:hover:bg-red-950/40 transition-colors"
                      title="Delete fact"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
