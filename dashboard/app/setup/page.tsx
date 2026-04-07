'use client';

import { useState, useEffect } from 'react';
import { useSetupStatus, usePermissions } from '@/lib/hooks';
import { saveCredentials, testAnthropic, openPermissionSettings, requestAutomation, requestContactsPermission, startAgent } from '@/lib/api';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import {
  CheckCircle2,
  XCircle,
  Key,
  Shield,
  TestTube,
  ChevronRight,
  ArrowLeft,
  ExternalLink,
  Rocket,
  MessageSquare,
} from 'lucide-react';

type Step = 'welcome' | 'permissions' | 'apikey' | 'complete';

export default function SetupPage() {
  const { data: setup, mutate: mutateSetup } = useSetupStatus();
  const { data: perms, mutate: mutatePerms } = usePermissions();
  const [step, setStep] = useState<Step>('welcome');
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [permLoading, setPermLoading] = useState<string | null>(null);

  useEffect(() => {
    if (setup && !setup.needsSetup) {
      setStep('complete');
    }
  }, [setup]);

  const handleTestApi = async () => {
    if (!apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAnthropic(apiKey.trim());
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await saveCredentials(apiKey.trim());
      await mutateSetup();
      setStep('complete');
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleStartAgent = async () => {
    setStarting(true);
    try {
      await startAgent();
      window.location.href = '/';
    } catch {
      setStarting(false);
    }
  };

  const handlePermAction = async (id: string) => {
    setPermLoading(id);
    try {
      if (id === 'automation') await requestAutomation();
      else if (id === 'contacts') await requestContactsPermission();
      else await openPermissionSettings(id);
    } catch { /* ignore */ }
    setTimeout(() => {
      mutatePerms();
      mutateSetup();
      setPermLoading(null);
    }, 3000);
  };

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-38px)] p-6">
      <div className="w-full max-w-lg">
        {/* Welcome Step */}
        {step === 'welcome' && (
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-brand-100 dark:bg-brand-950/40 flex items-center justify-center mx-auto mb-6">
              <MessageSquare className="w-8 h-8 text-brand-600 dark:text-brand-400" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Welcome to TextMyAgent</h1>
            <p className="text-[var(--color-text-secondary)] text-[14px] mb-8 max-w-sm mx-auto">
              Your AI-powered iMessage assistant. Let&apos;s get you set up in just a few steps.
            </p>
            <div className="space-y-3 mb-8 text-left">
              {[
                { num: 1, label: 'Grant macOS permissions', desc: 'Full Disk Access and Automation' },
                { num: 2, label: 'Add your Anthropic API key', desc: 'Powers the AI responses' },
                { num: 3, label: 'Start your agent', desc: 'Begin responding to messages' },
              ].map(({ num, label, desc }) => (
                <div key={num} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-bg-secondary)]">
                  <div className="w-8 h-8 rounded-full bg-[var(--color-brand)] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {num}
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold">{label}</p>
                    <p className="text-[12px] text-[var(--color-text-tertiary)]">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <Button
              variant="primary"
              size="lg"
              icon={<ChevronRight className="w-4 h-4" />}
              onClick={() => setStep('permissions')}
              className="w-full"
            >
              Get Started
            </Button>
          </div>
        )}

        {/* Permissions Step */}
        {step === 'permissions' && (
          <div>
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => setStep('welcome')} className="mb-4">
              Back
            </Button>
            <div className="flex items-center gap-3 mb-6">
              <Shield className="w-6 h-6 text-[var(--color-brand)]" aria-hidden="true" />
              <div>
                <h2 className="text-lg font-semibold">macOS Permissions</h2>
                <p className="text-[13px] text-[var(--color-text-secondary)]">TextMyAgent needs access to read and send iMessages</p>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              {perms?.permissions?.map((perm) => (
                <Card key={perm.id} padding="md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-[13px] font-semibold">{perm.name}</h3>
                        {perm.required && (
                          <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded">Required</span>
                        )}
                      </div>
                      <p className="text-[12px] text-[var(--color-text-secondary)]">{perm.description}</p>
                      {perm.status !== 'granted' && perm.instructions && (
                        <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{perm.instructions}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge status={perm.status as any} />
                      {perm.status !== 'granted' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<ExternalLink className="w-3 h-3" />}
                          loading={permLoading === perm.id}
                          onClick={() => handlePermAction(perm.id)}
                        >
                          {perm.id === 'automation' || perm.id === 'contacts' ? 'Request' : 'Open Settings'}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <Button
              variant="primary"
              size="lg"
              icon={<ChevronRight className="w-4 h-4" />}
              onClick={() => setStep('apikey')}
              className="w-full"
            >
              Continue to API Key
            </Button>
          </div>
        )}

        {/* API Key Step */}
        {step === 'apikey' && (
          <div>
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => setStep('permissions')} className="mb-4">
              Back
            </Button>
            <div className="flex items-center gap-3 mb-6">
              <Key className="w-6 h-6 text-[var(--color-brand)]" aria-hidden="true" />
              <div>
                <h2 className="text-lg font-semibold">Anthropic API Key</h2>
                <p className="text-[13px] text-[var(--color-text-secondary)]">Required to power AI responses via Claude</p>
              </div>
            </div>

            <Card className="mb-6">
              <div className="space-y-3">
                <div>
                  <label htmlFor="setup-api-key" className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1">
                    API Key
                  </label>
                  <input
                    id="setup-api-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-ant-..."
                    className="w-full px-3 py-2 text-[13px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)] outline-none font-mono"
                    autoComplete="off"
                    aria-describedby="setup-key-help"
                  />
                  <p id="setup-key-help" className="text-[11px] text-[var(--color-text-tertiary)] mt-1.5">
                    Get your key from{' '}
                    <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand)] hover:underline">
                      console.anthropic.com
                    </a>
                    . Your key is encrypted and stored securely in the macOS Keychain.
                  </p>
                </div>

                {testResult && (
                  <div
                    className={`flex items-center gap-2 text-[12px] p-2.5 rounded-lg ${
                      testResult.success
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                        : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'
                    }`}
                    role="alert"
                  >
                    {testResult.success ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
                    {testResult.success ? 'API key is valid!' : testResult.error || 'Test failed'}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<TestTube className="w-3.5 h-3.5" />}
                    loading={testing}
                    onClick={handleTestApi}
                    disabled={!apiKey.trim()}
                  >
                    Test Key
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Key className="w-3.5 h-3.5" />}
                    loading={saving}
                    onClick={handleSaveKey}
                    disabled={!apiKey.trim()}
                  >
                    Save &amp; Continue
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Complete Step */}
        {step === 'complete' && (
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold mb-2">You&apos;re All Set!</h1>
            <p className="text-[var(--color-text-secondary)] text-[14px] mb-8 max-w-sm mx-auto">
              TextMyAgent is configured and ready to go. Start your agent to begin responding to iMessages automatically.
            </p>
            <div className="space-y-3">
              <Button
                variant="primary"
                size="lg"
                icon={<Rocket className="w-4 h-4" />}
                loading={starting}
                onClick={handleStartAgent}
                className="w-full"
              >
                Start Agent &amp; Go to Dashboard
              </Button>
              <Button
                variant="ghost"
                size="md"
                onClick={() => { window.location.href = '/'; }}
                className="w-full"
              >
                Skip to Dashboard
              </Button>
            </div>
          </div>
        )}

        {/* Step indicator */}
        <div className="flex justify-center gap-2 mt-8" role="progressbar" aria-valuenow={['welcome', 'permissions', 'apikey', 'complete'].indexOf(step) + 1} aria-valuemin={1} aria-valuemax={4}>
          {['welcome', 'permissions', 'apikey', 'complete'].map((s) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                s === step ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-border)]'
              }`}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
