'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSetupStatus, usePermissions } from '@/lib/hooks';
import {
  startModelDownload,
  getModelStatus,
  testModel,
  openPermissionSettings,
  requestAutomation,
  requestContactsPermission,
  startAgent,
  type Permission,
} from '@/lib/api';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import {
  CheckCircle2,
  XCircle,
  Download,
  Shield,
  HardDrive,
  ChevronRight,
  ArrowLeft,
  ExternalLink,
  Rocket,
  MessageSquare,
  Loader2,
  AlertTriangle,
  Cpu,
  Lock,
  Users,
  Zap,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Step = 'welcome' | 'permissions' | 'model' | 'ready';

const STEPS: { id: Step; label: string }[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'model', label: 'AI Model' },
  { id: 'ready', label: 'Launch' },
];

// ---------------------------------------------------------------------------
// Stepper — visual progress bar at the top
// ---------------------------------------------------------------------------
function Stepper({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <nav aria-label="Setup progress" className="mb-10">
      <ol className="flex items-center gap-0">
        {STEPS.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <li key={s.id} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5 relative z-10">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                    done
                      ? 'bg-emerald-500 text-white'
                      : active
                        ? 'bg-[var(--color-brand)] text-white ring-4 ring-[var(--color-brand)]/20'
                        : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]'
                  }`}
                  aria-current={active ? 'step' : undefined}
                >
                  {done ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                </div>
                <span
                  className={`text-[11px] font-medium whitespace-nowrap ${
                    done || active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-tertiary)]'
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 mx-2 mt-[-18px]">
                  <div
                    className={`h-0.5 rounded-full transition-colors duration-300 ${
                      i < idx ? 'bg-emerald-500' : 'bg-[var(--color-border)]'
                    }`}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Permission row component
// ---------------------------------------------------------------------------
function PermRow({
  name,
  description,
  status,
  required,
  icon: Icon,
  loading,
  onAction,
  actionLabel,
}: {
  name: string;
  description: string;
  status: string;
  required: boolean;
  icon: React.ElementType;
  loading: boolean;
  onAction: () => void;
  actionLabel: string;
}) {
  const granted = status === 'granted';
  return (
    <div
      className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-300 ${
        granted
          ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20'
          : 'border-[var(--color-border)] bg-[var(--color-bg)]'
      }`}
    >
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors duration-300 ${
          granted
            ? 'bg-emerald-100 dark:bg-emerald-900/40'
            : 'bg-amber-100 dark:bg-amber-950/40'
        }`}
      >
        {granted ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Icon className={`w-5 h-5 ${required ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--color-text-tertiary)]'}`} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">{name}</span>
          {required && !granted && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">
              Required
            </span>
          )}
        </div>
        <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5">{description}</p>
      </div>

      <div className="flex-shrink-0">
        {granted ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Granted
          </span>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            icon={<ExternalLink className="w-3 h-3" />}
            loading={loading}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Setup Page
// ---------------------------------------------------------------------------
export default function SetupPage() {
  const { data: setup, mutate: mutateSetup } = useSetupStatus();
  const { data: perms, mutate: mutatePerms } = usePermissions();

  const [step, setStep] = useState<Step>('welcome');
  const [permLoading, setPermLoading] = useState<string | null>(null);

  // Model state
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  // Launch state
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Track if model was already downloaded when we arrive
  const checkedInitialModel = useRef(false);
  const downloadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup download polling on unmount
  useEffect(() => {
    return () => {
      if (downloadPollRef.current) clearInterval(downloadPollRef.current);
    };
  }, []);

  // -----------------------------------------------------------------------
  // Auto-detect initial state: skip to furthest valid step
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!setup || checkedInitialModel.current) return;
    checkedInitialModel.current = true;

    if (!setup.needsSetup) {
      setStep('ready');
      return;
    }

    const requiredOk = setup.permissions?.requiredGranted;
    const hasModel = setup.steps?.modelDownloaded;

    if (requiredOk && hasModel) {
      setStep('ready');
    } else if (requiredOk) {
      setStep('model');
      if (hasModel) {
        setModelReady(true);
      }
    }
    // else stay on 'welcome'
  }, [setup]);

  // -----------------------------------------------------------------------
  // Real-time permission polling (every 2s) while on permissions step
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (step !== 'permissions') return;
    const interval = setInterval(() => {
      mutatePerms();
      mutateSetup();
    }, 2000);
    return () => clearInterval(interval);
  }, [step, mutatePerms, mutateSetup]);

  // -----------------------------------------------------------------------
  // Derived permission state
  // -----------------------------------------------------------------------
  const requiredPermissions = perms?.permissions?.filter((p: Permission) => p.required) || [];
  const optionalPermissions = perms?.permissions?.filter((p: Permission) => !p.required) || [];
  const allRequiredGranted = requiredPermissions.length > 0 && requiredPermissions.every((p: Permission) => p.status === 'granted');

  // -----------------------------------------------------------------------
  // Permission actions
  // -----------------------------------------------------------------------
  const handlePermAction = useCallback(
    async (id: string) => {
      setPermLoading(id);
      try {
        if (id === 'automation') await requestAutomation();
        else if (id === 'contacts') await requestContactsPermission();
        else await openPermissionSettings(id);
      } catch (err) {
        console.error(`[Setup] Permission action failed for ${id}:`, err);
      }
      setTimeout(() => {
        mutatePerms();
        mutateSetup();
        setPermLoading(null);
      }, 2500);
    },
    [mutatePerms, mutateSetup]
  );

  // -----------------------------------------------------------------------
  // Model load / test
  // -----------------------------------------------------------------------
  const handleLoadModel = useCallback(async () => {
    setModelLoading(true);
    setModelError(null);
    try {
      const result = await testModel();
      if (result.success) {
        setModelLoaded(true);
      } else {
        setModelError(result.error || 'Model failed to load');
      }
    } catch (err: any) {
      setModelError(err.message || 'Failed to load model');
    } finally {
      setModelLoading(false);
    }
  }, []);

  // -----------------------------------------------------------------------
  // Model download
  // -----------------------------------------------------------------------
  const handleDownloadModel = useCallback(async () => {
    setDownloading(true);
    setModelError(null);
    try {
      await startModelDownload();
      if (downloadPollRef.current) clearInterval(downloadPollRef.current);
      downloadPollRef.current = setInterval(async () => {
        try {
          const s = await getModelStatus();
          setDownloadProgress(s.downloadProgress ?? 0);
          if (s.isDownloaded) {
            clearInterval(downloadPollRef.current!);
            downloadPollRef.current = null;
            setDownloading(false);
            setModelReady(true);
            setDownloadProgress(100);
            await mutateSetup();
            // Auto-load after download
            handleLoadModel();
          }
          if (s.status === 'error') {
            clearInterval(downloadPollRef.current!);
            downloadPollRef.current = null;
            setDownloading(false);
            setModelError(s.errorMessage || 'Download failed. Please try again.');
          }
        } catch {
          clearInterval(downloadPollRef.current!);
          downloadPollRef.current = null;
          setDownloading(false);
          setModelError('Lost connection while downloading. Please retry.');
        }
      }, 1500);
    } catch (err: any) {
      setDownloading(false);
      setModelError(err.message || 'Failed to start download');
    }
  }, [mutateSetup, handleLoadModel]);

  // -----------------------------------------------------------------------
  // Auto-start model download when arriving at the model step
  // -----------------------------------------------------------------------
  const downloadTriggered = useRef(false);
  useEffect(() => {
    if (step !== 'model') return;
    if (modelReady || downloading || downloadTriggered.current) return;
    if (setup?.steps?.modelDownloaded) {
      setModelReady(true);
      return;
    }
    downloadTriggered.current = true;
    handleDownloadModel();
  }, [step, modelReady, downloading, setup, handleDownloadModel]);

  // -----------------------------------------------------------------------
  // Start agent & redirect
  // -----------------------------------------------------------------------
  const handleStartAgent = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      await startAgent();
      await mutateSetup();
      window.location.href = '/';
    } catch (err: any) {
      setStartError(err.message || 'Failed to start agent');
      setStarting(false);
    }
  }, [mutateSetup]);

  // -----------------------------------------------------------------------
  // Icon map for permission types
  // -----------------------------------------------------------------------
  const PERM_ICONS: Record<string, React.ElementType> = {
    full_disk_access: HardDrive,
    automation: Zap,
    contacts: Users,
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-38px)] p-6">
      <div className="w-full max-w-xl">
        <Stepper current={step} />

        {/* ============================================================= */}
        {/* STEP 1: WELCOME                                                */}
        {/* ============================================================= */}
        {step === 'welcome' && (
          <div className="animate-in fade-in">
            <div className="text-center mb-10">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[var(--color-brand)] to-blue-600 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-[var(--color-brand)]/20">
                <MessageSquare className="w-10 h-10 text-white" aria-hidden="true" />
              </div>
              <h1 className="text-2xl font-bold mb-2">Welcome to TextMyAgent</h1>
              <p className="text-[var(--color-text-secondary)] text-[14px] max-w-sm mx-auto">
                Your AI-powered iMessage assistant. Let&apos;s get everything set up in a few quick steps.
              </p>
            </div>

            <div className="space-y-3 mb-8">
              {[
                {
                  icon: Shield,
                  label: 'Grant macOS Permissions',
                  desc: 'Full Disk Access to read messages, Automation to send replies',
                  color: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40',
                },
                {
                  icon: Cpu,
                  label: 'Download AI Model',
                  desc: 'Gemma 4 E4B runs 100% locally — your data never leaves your Mac',
                  color: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-950/40',
                },
                {
                  icon: Rocket,
                  label: 'Launch Your Agent',
                  desc: 'Start responding to iMessages automatically',
                  color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/40',
                },
              ].map(({ icon: Icon, label, desc, color }, i) => (
                <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
                    <Icon className="w-5 h-5" />
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

        {/* ============================================================= */}
        {/* STEP 2: PERMISSIONS                                            */}
        {/* ============================================================= */}
        {step === 'permissions' && (
          <div className="animate-in fade-in">
            <button
              onClick={() => setStep('welcome')}
              className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] mb-5 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>

            <div className="flex items-center gap-3 mb-2">
              <Shield className="w-6 h-6 text-[var(--color-brand)]" aria-hidden="true" />
              <h2 className="text-lg font-semibold">macOS Permissions</h2>
            </div>
            <p className="text-[13px] text-[var(--color-text-secondary)] mb-6">
              TextMyAgent needs these macOS permissions to read your iMessages and send replies. Grant them below, and this page will update automatically.
            </p>

            {/* Required permissions */}
            <div className="space-y-3 mb-4">
              {requiredPermissions.map((perm: any) => (
                <PermRow
                  key={perm.id}
                  name={perm.name}
                  description={perm.description}
                  status={perm.status}
                  required={true}
                  icon={PERM_ICONS[perm.id] || Lock}
                  loading={permLoading === perm.id}
                  onAction={() => handlePermAction(perm.id)}
                  actionLabel={perm.id === 'automation' ? 'Request Access' : 'Open Settings'}
                />
              ))}
            </div>

            {/* Optional permissions */}
            {optionalPermissions.length > 0 && (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3 mt-6">
                  Optional
                </p>
                <div className="space-y-3 mb-6">
                  {optionalPermissions.map((perm: any) => (
                    <PermRow
                      key={perm.id}
                      name={perm.name}
                      description={perm.description}
                      status={perm.status}
                      required={false}
                      icon={PERM_ICONS[perm.id] || Lock}
                      loading={permLoading === perm.id}
                      onAction={() => handlePermAction(perm.id)}
                      actionLabel={perm.id === 'contacts' ? 'Request Access' : 'Open Settings'}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Gated continue button */}
            <div className="mt-8">
              {!allRequiredGranted && (
                <div className="flex items-center gap-2 text-[12px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 p-3 rounded-lg mb-4 border border-amber-200 dark:border-amber-900/50">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>Grant all required permissions above to continue.</span>
                </div>
              )}
              <Button
                variant="primary"
                size="lg"
                icon={<ChevronRight className="w-4 h-4" />}
                onClick={() => setStep('model')}
                disabled={!allRequiredGranted}
                className="w-full"
              >
                Continue to Model Setup
              </Button>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* STEP 3: MODEL DOWNLOAD                                         */}
        {/* ============================================================= */}
        {step === 'model' && (
          <div className="animate-in fade-in">
            <button
              onClick={() => setStep('permissions')}
              className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] mb-5 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>

            <div className="flex items-center gap-3 mb-2">
              <Cpu className="w-6 h-6 text-[var(--color-brand)]" aria-hidden="true" />
              <h2 className="text-lg font-semibold">Download AI Model</h2>
            </div>
            <p className="text-[13px] text-[var(--color-text-secondary)] mb-6">
              Gemma 4 E4B is downloading automatically. It runs entirely on your Mac — no API keys, no cloud.
            </p>

            <Card padding="lg" className="mb-6">
              <div className="space-y-4">
                {/* Model info */}
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center flex-shrink-0">
                    <Cpu className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold">Gemma 4 E4B</p>
                    <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5">Q4_K_M quantization • Apache 2.0 license</p>
                    <div className="flex items-center gap-4 mt-2 text-[11px] text-[var(--color-text-tertiary)]">
                      <span>~5 GB download</span>
                      <span>•</span>
                      <span>~8 GB RAM</span>
                      <span>•</span>
                      <span>By Google via Hugging Face</span>
                    </div>
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-[var(--color-border)]" />

                {/* Download progress */}
                {downloading && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-[12px]">
                      <span className="text-[var(--color-text-secondary)] flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Downloading model…
                      </span>
                      <span className="font-semibold tabular-nums">{downloadProgress}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-[var(--color-bg-secondary)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[var(--color-brand)] to-blue-500 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${downloadProgress}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-[var(--color-text-tertiary)]">
                      This may take a few minutes depending on your connection.
                    </p>
                  </div>
                )}

                {/* Model loading indicator */}
                {modelReady && modelLoading && !modelLoaded && (
                  <div className="flex items-center gap-2 text-[12px] p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50">
                    <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                    Loading model into memory… This may take a moment.
                  </div>
                )}

                {/* Model loaded success */}
                {modelLoaded && (
                  <div className="flex items-center gap-2 text-[12px] p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50" role="alert">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    Model downloaded and loaded successfully!
                  </div>
                )}

                {/* Model downloaded but not loaded yet (no auto-load running) */}
                {modelReady && !modelLoading && !modelLoaded && !modelError && (
                  <div className="flex items-center gap-2 text-[12px] p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50" role="alert">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    Model downloaded! Ready to continue.
                  </div>
                )}

                {/* Error state */}
                {modelError && (
                  <div className="flex items-center gap-2 text-[12px] p-3 rounded-lg bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50" role="alert">
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                    {modelError}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-3">
                  {!modelReady && !downloading && !modelError && (
                    <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Starting download…
                    </div>
                  )}
                  {modelError && (
                    <Button
                      variant="secondary"
                      size="md"
                      icon={<Download className="w-4 h-4" />}
                      onClick={() => { downloadTriggered.current = false; handleDownloadModel(); }}
                    >
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            </Card>

            {/* Continue to launch */}
            <Button
              variant="primary"
              size="lg"
              icon={<ChevronRight className="w-4 h-4" />}
              onClick={() => setStep('ready')}
              disabled={!modelReady}
              className="w-full"
            >
              {modelReady ? 'Continue' : 'Waiting for download…'}
            </Button>
          </div>
        )}

        {/* ============================================================= */}
        {/* STEP 4: READY TO LAUNCH                                        */}
        {/* ============================================================= */}
        {step === 'ready' && (
          <div className="animate-in fade-in text-center">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/20">
              <Rocket className="w-10 h-10 text-white" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold mb-2">You&apos;re All Set!</h1>
            <p className="text-[var(--color-text-secondary)] text-[14px] mb-4 max-w-sm mx-auto">
              TextMyAgent is configured and ready to go. Start your agent to begin responding to iMessages automatically.
            </p>

            {/* Quick summary */}
            <div className="grid grid-cols-3 gap-3 mb-8 text-left">
              {[
                {
                  icon: Shield,
                  label: 'Permissions',
                  value: allRequiredGranted ? 'All granted' : 'Needs attention',
                  ok: allRequiredGranted,
                },
                {
                  icon: Cpu,
                  label: 'AI Model',
                  value: modelReady || setup?.steps?.modelDownloaded ? 'Ready' : 'Not downloaded',
                  ok: modelReady || setup?.steps?.modelDownloaded,
                },
                {
                  icon: Lock,
                  label: 'Privacy',
                  value: 'On-device',
                  ok: true,
                },
              ].map(({ icon: Icon, label, value, ok }) => (
                <div
                  key={label}
                  className={`p-3 rounded-xl border text-center ${
                    ok
                      ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20'
                      : 'border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 mx-auto mb-1 ${
                      ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                    }`}
                  />
                  <p className="text-[11px] font-semibold">{label}</p>
                  <p className="text-[10px] text-[var(--color-text-tertiary)]">{value}</p>
                </div>
              ))}
            </div>

            {startError && (
              <div className="flex items-center gap-2 text-[12px] p-3 rounded-lg bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50 mb-4" role="alert">
                <XCircle className="w-4 h-4 flex-shrink-0" />
                {startError}
              </div>
            )}

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
                onClick={() => {
                  try { localStorage.setItem('setup-skipped', '1'); } catch {}
                  window.location.href = '/';
                }}
                className="w-full"
              >
                Skip to Dashboard
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
