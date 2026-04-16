'use client';

import { useState } from 'react';
import { usePermissions } from '@/lib/hooks';
import { openPermissionSettings, requestAutomation, requestContactsPermission } from '@/lib/api';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Shield, ExternalLink, CheckCircle2, AlertTriangle, Info } from 'lucide-react';

export default function PermissionsPage() {
  const { data, error, isLoading, mutate } = usePermissions();
  const [loading, setLoading] = useState<string | null>(null);

  const handleOpenSettings = async (permissionId: string) => {
    setLoading(permissionId);
    try {
      await openPermissionSettings(permissionId);
    } catch { /* ignore */ }
    // Re-check permissions after a delay
    setTimeout(() => {
      mutate();
      setLoading(null);
    }, 2000);
  };

  const handleRequestAutomation = async () => {
    setLoading('automation');
    try {
      await requestAutomation();
    } catch { /* ignore */ }
    setTimeout(() => {
      mutate();
      setLoading(null);
    }, 3000);
  };

  const handleRequestContacts = async () => {
    setLoading('contacts');
    try {
      await requestContactsPermission();
    } catch { /* ignore */ }
    setTimeout(() => {
      mutate();
      setLoading(null);
    }, 3000);
  };

  if (error) {
    return (
      <div className="p-6">
        <PageHeader title="Permissions" />
        <Card className="border-red-200 dark:border-red-900">
          <p className="text-[13px] text-red-600 dark:text-red-400" role="alert">
            Failed to load permissions.
          </p>
        </Card>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="p-6">
        <PageHeader title="Permissions" />
        <LoadingSpinner label="Checking permissions..." />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader
        title="Permissions"
        description="macOS permissions required for TextMyAgent to function"
      />

      {/* Overall status */}
      <Card className="mb-6">
        <div className="flex items-center gap-3">
          {data.requiredGranted ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <div>
                <p className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">All required permissions granted</p>
                <p className="text-[12px] text-[var(--color-text-secondary)]">Your agent is ready to run.</p>
              </div>
            </>
          ) : (
            <>
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <div>
                <p className="text-[13px] font-semibold text-amber-700 dark:text-amber-400">Some permissions are missing</p>
                <p className="text-[12px] text-[var(--color-text-secondary)]">Grant the required permissions below to use the agent.</p>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Permission cards */}
      <div className="space-y-3">
        {data.permissions.map((perm) => (
          <Card key={perm.id} padding="md">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-[13px] font-semibold">{perm.name}</h3>
                  {perm.required && (
                    <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded">
                      Required
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-[var(--color-text-secondary)] mb-2">{perm.description}</p>

                {perm.status !== 'granted' && perm.instructions && (
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-[var(--color-bg-secondary)] text-[11px] text-[var(--color-text-secondary)]">
                    <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{perm.instructions}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <StatusBadge status={perm.status as any} />
                {perm.status !== 'granted' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<ExternalLink className="w-3 h-3" />}
                    loading={loading === perm.id}
                    onClick={() => {
                      if (perm.id === 'automation') handleRequestAutomation();
                      else if (perm.id === 'contacts') handleRequestContacts();
                      else handleOpenSettings(perm.id);
                    }}
                  >
                    {perm.id === 'automation' || perm.id === 'contacts' ? 'Request' : 'Open Settings'}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

    </div>
  );
}
