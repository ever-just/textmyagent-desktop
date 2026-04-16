'use client';

import { useState, useEffect, useRef } from 'react';
import { useConfig } from '@/lib/hooks';
import { updateConfig, getModelStatus, startModelDownload, testModel } from '@/lib/api';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Save, CheckCircle2, XCircle, Info, User, Shield, Wrench, Brain, Clock, Users, Plus, X, Download, Cpu, Power, Loader2, RefreshCw } from 'lucide-react';

type SettingsTab = 'general' | 'persona' | 'tools' | 'memory' | 'security';

export default function SettingsPage() {
  const { data: config, error, mutate } = useConfig();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  // General form state
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [contextSize, setContextSize] = useState(8192);
  const [gpuLayers, setGpuLayers] = useState(-1);
  const [maxResponseChars, setMaxResponseChars] = useState(500);

  // Model management state
  const [modelAction, setModelAction] = useState<'idle' | 'loading' | 'downloading' | 'testing'>('idle');
  const [modelActionMsg, setModelActionMsg] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const downloadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup download polling on unmount
  useEffect(() => {
    return () => {
      if (downloadPollRef.current) clearInterval(downloadPollRef.current);
    };
  }, []);
  const [multiMessageSplit, setMultiMessageSplit] = useState(true);
  const [splitDelay, setSplitDelay] = useState(1.5);

  // Persona form state
  const [agentName, setAgentName] = useState('Grace');
  const [identity, setIdentity] = useState('');
  const [persona, setPersona] = useState('');
  const [guidelines, setGuidelines] = useState('');
  const [safety, setSafety] = useState('');
  const [format, setFormat] = useState('');

  // Tools form state
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [webSearch, setWebSearch] = useState(true);
  const [webSearchMaxUses, setWebSearchMaxUses] = useState(3);
  const [saveUserFact, setSaveUserFact] = useState(true);
  const [getUserFacts, setGetUserFacts] = useState(true);
  const [searchHistory, setSearchHistory] = useState(true);
  const [reminders, setReminders] = useState(true);
  const [triggers, setTriggers] = useState(true);
  const [reactions, setReactions] = useState(true);
  const [waitTool, setWaitTool] = useState(true);

  // Contact allowlist state
  const [replyMode, setReplyMode] = useState<'everyone' | 'allowlist'>('everyone');
  const [allowedContacts, setAllowedContacts] = useState<string[]>([]);
  const [newContact, setNewContact] = useState('');

  // Memory form state
  const [factTTLDays, setFactTTLDays] = useState(90);
  const [maxFactsPerUser, setMaxFactsPerUser] = useState(50);

  // Security form state
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(10);
  const [rateLimitGlobalPerHour, setRateLimitGlobalPerHour] = useState(200);
  const [dailyBudgetCents, setDailyBudgetCents] = useState(0);
  const [maxApiCallsPerMessage, setMaxApiCallsPerMessage] = useState(6);
  const [outputSanitization, setOutputSanitization] = useState(true);

  // Polling form state
  const [activeIntervalMs, setActiveIntervalMs] = useState(2000);
  const [idleIntervalMs, setIdleIntervalMs] = useState(5000);
  const [sleepIntervalMs, setSleepIntervalMs] = useState(15000);

  // UI state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setTemperature(config.model.temperature);
      setMaxTokens(config.model.responseMaxTokens);
      setContextSize(config.model.contextSize);
      // Load extended settings from config.settings if available
      const s = config.settings || {};
      setGpuLayers(s['model.gpuLayers'] ?? -1);
      setMaxResponseChars(s['agent.maxResponseChars'] ?? 500);
      setMultiMessageSplit(s['agent.multiMessageSplit'] ?? true);
      setSplitDelay(s['agent.splitDelaySeconds'] ?? 1.5);
      setAgentName(s['agent.name'] ?? 'Grace');
      setIdentity(s['agent.identity'] ?? '');
      setPersona(s['agent.persona'] ?? '');
      setGuidelines(s['agent.guidelines'] ?? '');
      setSafety(s['agent.safety'] ?? '');
      setFormat(s['agent.format'] ?? '');
      setToolsEnabled(s['tools.enabled'] ?? true);
      setWebSearch(s['tools.webSearch'] ?? true);
      setWebSearchMaxUses(s['tools.webSearchMaxUses'] ?? 3);
      setSaveUserFact(s['tools.saveUserFact'] ?? true);
      setGetUserFacts(s['tools.getUserFacts'] ?? true);
      setSearchHistory(s['tools.searchHistory'] ?? true);
      setReminders(s['tools.reminders'] ?? true);
      setTriggers(s['tools.triggers'] ?? true);
      setReactions(s['tools.reactions'] ?? true);
      setWaitTool(s['tools.waitTool'] ?? true);
      // Contact allowlist
      setReplyMode(s['agent.replyMode'] ?? 'everyone');
      setAllowedContacts(s['agent.allowedContacts'] ?? []);
      setFactTTLDays(s['memory.factTTLDays'] ?? 90);
      setMaxFactsPerUser(s['memory.maxFactsPerUser'] ?? 50);
      setRateLimitPerMinute(s['security.rateLimitPerMinute'] ?? 10);
      setRateLimitGlobalPerHour(s['security.rateLimitGlobalPerHour'] ?? 200);
      setDailyBudgetCents(s['security.dailyBudgetCents'] ?? 0);
      setMaxApiCallsPerMessage(s['security.maxApiCallsPerMessage'] ?? 6);
      setOutputSanitization(s['security.outputSanitization'] ?? true);
      setActiveIntervalMs(s['polling.activeIntervalMs'] ?? 2000);
      setIdleIntervalMs(s['polling.idleIntervalMs'] ?? 5000);
      setSleepIntervalMs(s['polling.sleepIntervalMs'] ?? 15000);
    }
  }, [config]);

  const handleSaveConfig = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const updates: Record<string, any> = {
        // General / Model
        'model.temperature': temperature,
        'model.responseMaxTokens': maxTokens,
        'model.contextSize': contextSize,
        'model.gpuLayers': gpuLayers,
        'agent.maxResponseChars': maxResponseChars,
        'agent.multiMessageSplit': multiMessageSplit,
        'agent.splitDelaySeconds': splitDelay,
        // Persona
        'agent.name': agentName,
        'agent.identity': identity,
        'agent.persona': persona,
        'agent.guidelines': guidelines,
        'agent.safety': safety,
        'agent.format': format,
        // Tools
        'tools.enabled': toolsEnabled,
        'tools.webSearch': webSearch,
        'tools.webSearchMaxUses': webSearchMaxUses,
        'tools.saveUserFact': saveUserFact,
        'tools.getUserFacts': getUserFacts,
        'tools.searchHistory': searchHistory,
        'tools.reminders': reminders,
        'tools.triggers': triggers,
        'tools.reactions': reactions,
        'tools.waitTool': waitTool,
        // Contact allowlist
        'agent.replyMode': replyMode,
        'agent.allowedContacts': allowedContacts,
        // Memory
        'memory.factTTLDays': factTTLDays,
        'memory.maxFactsPerUser': maxFactsPerUser,
        // Security
        'security.rateLimitPerMinute': rateLimitPerMinute,
        'security.rateLimitGlobalPerHour': rateLimitGlobalPerHour,
        'security.dailyBudgetCents': dailyBudgetCents,
        'security.maxApiCallsPerMessage': maxApiCallsPerMessage,
        'security.outputSanitization': outputSanitization,
        // Polling
        'polling.activeIntervalMs': activeIntervalMs,
        'polling.idleIntervalMs': idleIntervalMs,
        'polling.sleepIntervalMs': sleepIntervalMs,
      };
      await updateConfig(updates);
      await mutate();
      setSaved(true);
      setSaveError(null);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save settings');
      setTimeout(() => setSaveError(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <PageHeader title="Settings" />
        <Card className="border-red-200 dark:border-red-900">
          <p className="text-[13px] text-red-600 dark:text-red-400" role="alert">
            Failed to load settings. Backend may be unavailable.
          </p>
        </Card>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="p-6">
        <PageHeader title="Settings" />
        <LoadingSpinner label="Loading settings..." />
      </div>
    );
  }

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'General', icon: <Info className="w-3.5 h-3.5" /> },
    { id: 'persona', label: 'Persona', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'tools', label: 'Tools', icon: <Wrench className="w-3.5 h-3.5" /> },
    { id: 'memory', label: 'Memory', icon: <Brain className="w-3.5 h-3.5" /> },
    { id: 'security', label: 'Security', icon: <Shield className="w-3.5 h-3.5" /> },
  ];

  const inputCls = 'w-full px-3 py-2 text-[13px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)] outline-none transition-colors';
  const textareaCls = inputCls + ' font-mono resize-y min-h-[80px]';
  const labelCls = 'block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1';
  const helpCls = 'text-[11px] text-[var(--color-text-tertiary)] mt-1';

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="Settings" description="Configure your AI agent and application preferences" />

      {/* Tabs */}
      <div className="flex gap-1.5 mb-6">
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

      {/* GENERAL TAB */}
      {activeTab === 'general' && (
        <>
          {/* Model Management Card */}
          <Card className="mb-6">
            <h2 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
              <Cpu className="w-4 h-4" aria-hidden="true" />
              AI Model
            </h2>

            {/* Model info + status */}
            <div className="flex items-start gap-4 p-3 rounded-lg bg-[var(--color-bg-secondary)] mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center flex-shrink-0">
                <Cpu className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold">Gemma 4 E4B</p>
                <p className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">Q4_K_M quantization • Apache 2.0 • ~5 GB on disk</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded-full ${
                    config.model.isLoaded ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                    : config.model.isDownloaded ? 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'
                    : 'bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400'
                  }`}>
                    {config.model.isLoaded ? '● Loaded into memory' : config.model.isDownloaded ? '● Downloaded — not loaded' : '● Not downloaded'}
                  </span>
                </div>
              </div>
            </div>

            {/* Model action feedback */}
            {modelActionMsg && (
              <div className={`flex items-center gap-2 text-[12px] p-2.5 rounded-lg mb-4 border ${
                modelActionMsg.startsWith('✓')
                  ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50'
                  : modelActionMsg.startsWith('✗')
                    ? 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900/50'
                    : 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50'
              }`}>
                {modelAction !== 'idle' && <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />}
                {modelActionMsg}
              </div>
            )}

            {/* Download progress */}
            {modelAction === 'downloading' && (
              <div className="mb-4">
                <div className="flex justify-between text-[11px] text-[var(--color-text-secondary)] mb-1">
                  <span>Downloading…</span>
                  <span className="font-semibold tabular-nums">{downloadProgress}%</span>
                </div>
                <div className="w-full h-2 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-[var(--color-brand)] to-blue-500 rounded-full transition-all duration-500" style={{ width: `${downloadProgress}%` }} />
                </div>
              </div>
            )}

            {/* Model action buttons */}
            <div className="flex flex-wrap gap-2 mb-5">
              {!config.model.isDownloaded && modelAction !== 'downloading' && (
                <Button variant="primary" size="sm" icon={<Download className="w-3.5 h-3.5" />}
                  onClick={async () => {
                    setModelAction('downloading');
                    setModelActionMsg('Downloading model…');
                    setDownloadProgress(0);
                    try {
                      await startModelDownload();
                      if (downloadPollRef.current) clearInterval(downloadPollRef.current);
                      downloadPollRef.current = setInterval(async () => {
                        try {
                          const st = await getModelStatus();
                          setDownloadProgress(st.downloadProgress ?? 0);
                          if (st.isDownloaded) {
                            clearInterval(downloadPollRef.current!);
                            downloadPollRef.current = null;
                            setModelAction('idle');
                            setModelActionMsg('✓ Model downloaded successfully');
                            await mutate();
                          }
                          if (st.status === 'error') {
                            clearInterval(downloadPollRef.current!);
                            downloadPollRef.current = null;
                            setModelAction('idle');
                            setModelActionMsg('✗ Download failed');
                          }
                        } catch { clearInterval(downloadPollRef.current!); downloadPollRef.current = null; setModelAction('idle'); setModelActionMsg('✗ Lost connection'); }
                      }, 1500);
                    } catch (err: any) { setModelAction('idle'); setModelActionMsg(`✗ ${err.message}`); }
                  }}
                >Download Model</Button>
              )}
              {config.model.isDownloaded && !config.model.isLoaded && (
                <Button variant="primary" size="sm" icon={<Power className="w-3.5 h-3.5" />}
                  loading={modelAction === 'loading'}
                  onClick={async () => {
                    setModelAction('loading');
                    setModelActionMsg('Loading model into memory…');
                    try {
                      const r = await testModel();
                      setModelAction('idle');
                      setModelActionMsg(r.success ? '✓ Model loaded successfully' : `✗ ${r.error}`);
                      await mutate();
                    } catch (err: any) { setModelAction('idle'); setModelActionMsg(`✗ ${err.message}`); }
                  }}
                >Load Model</Button>
              )}
              {config.model.isLoaded && (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400 px-2 py-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Model active
                </span>
              )}
              {config.model.isDownloaded && (
                <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />}
                  onClick={async () => {
                    setModelAction('downloading');
                    setModelActionMsg('Re-downloading model…');
                    setDownloadProgress(0);
                    try {
                      await startModelDownload();
                      if (downloadPollRef.current) clearInterval(downloadPollRef.current);
                      downloadPollRef.current = setInterval(async () => {
                        try {
                          const st = await getModelStatus();
                          setDownloadProgress(st.downloadProgress ?? 0);
                          if (st.isDownloaded) {
                            clearInterval(downloadPollRef.current!);
                            downloadPollRef.current = null;
                            setModelAction('idle');
                            setModelActionMsg('✓ Model re-downloaded');
                            await mutate();
                          }
                        } catch { clearInterval(downloadPollRef.current!); downloadPollRef.current = null; setModelAction('idle'); setModelActionMsg('✗ Re-download failed'); }
                      }, 1500);
                    } catch (err: any) { setModelAction('idle'); setModelActionMsg(`✗ ${err.message}`); }
                  }}
                >Re-download</Button>
              )}
            </div>

            <div className="border-t border-[var(--color-border)] pt-4 space-y-4">
              <div>
                <label htmlFor="temperature" className={labelCls}>Temperature: {temperature}</label>
                <input id="temperature" type="range" min="0" max="1" step="0.1" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="w-full accent-[var(--color-brand)]" />
                <p className={helpCls}>Lower = focused and deterministic. Higher = creative and varied.</p>
              </div>
              <div>
                <label htmlFor="max-tokens" className={labelCls}>Max Response Tokens</label>
                <input id="max-tokens" type="number" min={100} max={8192} value={maxTokens} onChange={(e) => setMaxTokens(parseInt(e.target.value) || 1024)} className={inputCls + ' font-mono'} />
                <p className={helpCls}>Maximum number of tokens the model can generate per response.</p>
              </div>
              <div>
                <label htmlFor="context-size" className={labelCls}>Context Window Size</label>
                <input id="context-size" type="number" min={2048} max={32768} value={contextSize} onChange={(e) => setContextSize(parseInt(e.target.value) || 8192)} className={inputCls + ' font-mono'} />
                <p className={helpCls}>Larger context uses more RAM. 8192 recommended for 8 GB systems, 16384 for 16 GB+. Requires model reload.</p>
              </div>
              <div>
                <label htmlFor="gpu-layers" className={labelCls}>GPU Layers</label>
                <input id="gpu-layers" type="number" min={-1} max={999} value={gpuLayers} onChange={(e) => setGpuLayers(parseInt(e.target.value))} className={inputCls + ' font-mono'} />
                <p className={helpCls}>Number of layers offloaded to GPU. -1 = auto (use all available GPU), 0 = CPU only. Requires model reload.</p>
              </div>
            </div>
          </Card>

          {/* Response Formatting */}
          <Card className="mb-6">
            <h2 className="text-[14px] font-semibold mb-4">Response Formatting</h2>
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Max Response Characters</label>
                <input type="number" min={100} max={5000} value={maxResponseChars} onChange={(e) => setMaxResponseChars(parseInt(e.target.value) || 500)} className={inputCls + ' font-mono'} />
                <p className={helpCls}>Responses longer than this will be split into multiple messages.</p>
              </div>
              <ToggleRow label="Multi-message splitting" checked={multiMessageSplit} onChange={setMultiMessageSplit} />
              {multiMessageSplit && (
                <div>
                  <label className={labelCls}>Split Delay (seconds)</label>
                  <input type="number" min={0.5} max={10} step={0.5} value={splitDelay} onChange={(e) => setSplitDelay(parseFloat(e.target.value) || 1.5)} className={inputCls + ' font-mono'} />
                </div>
              )}
            </div>
          </Card>

          {/* Polling */}
          <Card className="mb-6">
            <h2 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Adaptive Polling
            </h2>
            <p className="text-[12px] text-[var(--color-text-secondary)] mb-3">
              Polling speed adapts based on activity. Active = recent messages, Idle = 2-10 min, Sleep = 10+ min.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Active (ms)</label>
                <input type="number" min={500} max={10000} value={activeIntervalMs} onChange={(e) => setActiveIntervalMs(parseInt(e.target.value) || 2000)} className={inputCls + ' font-mono'} />
              </div>
              <div>
                <label className={labelCls}>Idle (ms)</label>
                <input type="number" min={1000} max={30000} value={idleIntervalMs} onChange={(e) => setIdleIntervalMs(parseInt(e.target.value) || 5000)} className={inputCls + ' font-mono'} />
              </div>
              <div>
                <label className={labelCls}>Sleep (ms)</label>
                <input type="number" min={5000} max={60000} value={sleepIntervalMs} onChange={(e) => setSleepIntervalMs(parseInt(e.target.value) || 15000)} className={inputCls + ' font-mono'} />
              </div>
            </div>
          </Card>

          {/* Contact Allowlist */}
          <Card className="mb-6">
            <h2 className="text-[14px] font-semibold mb-2 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Who Can Text the Agent
            </h2>
            <p className="text-[12px] text-[var(--color-text-secondary)] mb-4">
              Choose whether the agent responds to everyone or only specific contacts.
            </p>
            <div className="space-y-4">
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="replyMode"
                    value="everyone"
                    checked={replyMode === 'everyone'}
                    onChange={() => setReplyMode('everyone')}
                    className="accent-[var(--color-brand)]"
                  />
                  <span className="text-[13px]">Reply to everyone</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="replyMode"
                    value="allowlist"
                    checked={replyMode === 'allowlist'}
                    onChange={() => setReplyMode('allowlist')}
                    className="accent-[var(--color-brand)]"
                  />
                  <span className="text-[13px]">Only selected contacts</span>
                </label>
              </div>

              {replyMode === 'allowlist' && (
                <div className="border-t border-[var(--color-border)] pt-3">
                  <label className={labelCls}>Allowed Contacts</label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={newContact}
                      onChange={(e) => setNewContact(e.target.value)}
                      placeholder="+1 (555) 123-4567"
                      className={inputCls + ' flex-1'}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newContact.trim()) {
                          setAllowedContacts([...allowedContacts, newContact.trim()]);
                          setNewContact('');
                        }
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Plus className="w-3.5 h-3.5" />}
                      onClick={() => {
                        if (newContact.trim()) {
                          setAllowedContacts([...allowedContacts, newContact.trim()]);
                          setNewContact('');
                        }
                      }}
                      disabled={!newContact.trim()}
                    >
                      Add
                    </Button>
                  </div>
                  {allowedContacts.length === 0 ? (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      No contacts added yet. The agent won&apos;t respond to anyone until you add contacts.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {allowedContacts.map((contact, i) => (
                        <div key={i} className="flex items-center justify-between py-1 px-2 rounded bg-[var(--color-bg-tertiary)] text-[12px]">
                          <span className="font-mono">{contact}</span>
                          <button
                            onClick={() => setAllowedContacts(allowedContacts.filter((_, idx) => idx !== i))}
                            className="text-[var(--color-text-tertiary)] hover:text-red-500 transition-colors"
                            aria-label={`Remove ${contact}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className={helpCls}>Phone numbers are normalized for matching (last 10 digits).</p>
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      {/* PERSONA TAB */}
      {activeTab === 'persona' && (
        <>
          <Card className="mb-6">
            <h2 className="text-[14px] font-semibold mb-2 flex items-center gap-2">
              <User className="w-4 h-4" />
              Agent Persona
            </h2>
            <p className="text-[12px] text-[var(--color-text-secondary)] mb-4">
              Customize your AI assistant&apos;s personality, guidelines, and behavior. These sections form the system prompt.
            </p>
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Agent Name</label>
                <input type="text" value={agentName} onChange={(e) => setAgentName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Identity</label>
                <textarea value={identity} onChange={(e) => setIdentity(e.target.value)} className={textareaCls} rows={3} placeholder="Who is this AI?" />
                <p className={helpCls}>Core identity statement. Who is this AI and what does it do?</p>
              </div>
              <div>
                <label className={labelCls}>Persona</label>
                <textarea value={persona} onChange={(e) => setPersona(e.target.value)} className={textareaCls} rows={3} placeholder="Personality traits..." />
                <p className={helpCls}>Personality traits, tone, and communication style.</p>
              </div>
              <div>
                <label className={labelCls}>Guidelines</label>
                <textarea value={guidelines} onChange={(e) => setGuidelines(e.target.value)} className={textareaCls} rows={5} placeholder="Behavioral rules..." />
                <p className={helpCls}>Behavioral rules and response guidelines.</p>
              </div>
              <div>
                <label className={labelCls}>Format Rules</label>
                <textarea value={format} onChange={(e) => setFormat(e.target.value)} className={textareaCls} rows={3} placeholder="Formatting rules..." />
                <p className={helpCls}>Output formatting instructions.</p>
              </div>
              <div>
                <label className={labelCls}>Safety Rules</label>
                <textarea value={safety} onChange={(e) => setSafety(e.target.value)} className={textareaCls} rows={4} placeholder="Safety instructions..." />
                <p className={helpCls}>Safety guardrails and content restrictions. Be careful editing these.</p>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* TOOLS TAB */}
      {activeTab === 'tools' && (
        <Card className="mb-6">
          <h2 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
            <Wrench className="w-4 h-4" />
            Tool Settings
          </h2>
          <div className="space-y-3">
            <ToggleRow label="Tools enabled (master toggle)" checked={toolsEnabled} onChange={setToolsEnabled} />
            {toolsEnabled && (
              <>
                <div className="border-t border-[var(--color-border)] pt-3 mt-3">
                  <p className="text-[12px] font-medium text-[var(--color-text-secondary)] mb-2">Local Tools</p>
                  <ToggleRow label="Save User Fact" checked={saveUserFact} onChange={setSaveUserFact} />
                  <ToggleRow label="Get User Facts" checked={getUserFacts} onChange={setGetUserFacts} />
                  <ToggleRow label="Search History" checked={searchHistory} onChange={setSearchHistory} />
                  <ToggleRow label="Reminders" checked={reminders} onChange={setReminders} />
                  <ToggleRow label="Triggers" checked={triggers} onChange={setTriggers} />
                </div>
                <div className="border-t border-[var(--color-border)] pt-3">
                  <p className="text-[12px] font-medium text-[var(--color-text-secondary)] mb-2">Interaction Tools</p>
                  <ToggleRow label="Reactions (tapback-style emoji responses)" checked={reactions} onChange={setReactions} />
                  <ToggleRow label="Wait (agent can choose not to reply)" checked={waitTool} onChange={setWaitTool} />
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {/* MEMORY TAB */}
      {activeTab === 'memory' && (
        <Card className="mb-6">
          <h2 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
            <Brain className="w-4 h-4" />
            Memory Settings
          </h2>
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Fact TTL (days)</label>
              <input type="number" min={0} max={365} value={factTTLDays} onChange={(e) => setFactTTLDays(parseInt(e.target.value) || 90)} className={inputCls + ' font-mono'} />
              <p className={helpCls}>How long user facts are kept before expiring. 0 = never expire.</p>
            </div>
            <div>
              <label className={labelCls}>Max Facts Per User</label>
              <input type="number" min={10} max={500} value={maxFactsPerUser} onChange={(e) => setMaxFactsPerUser(parseInt(e.target.value) || 50)} className={inputCls + ' font-mono'} />
              <p className={helpCls}>Oldest facts are evicted when this limit is reached.</p>
            </div>
          </div>
        </Card>
      )}

      {/* SECURITY TAB */}
      {activeTab === 'security' && (
        <Card className="mb-6">
          <h2 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Security Settings
          </h2>
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Rate Limit (per user per minute)</label>
              <input type="number" min={1} max={100} value={rateLimitPerMinute} onChange={(e) => setRateLimitPerMinute(parseInt(e.target.value) || 10)} className={inputCls + ' font-mono'} />
            </div>
            <div>
              <label className={labelCls}>Global Rate Limit (per hour)</label>
              <input type="number" min={10} max={10000} value={rateLimitGlobalPerHour} onChange={(e) => setRateLimitGlobalPerHour(parseInt(e.target.value) || 200)} className={inputCls + ' font-mono'} />
            </div>
            <div>
              <label className={labelCls}>Daily Token Budget (0 = unlimited)</label>
              <input type="number" min={0} max={10000000} value={dailyBudgetCents} onChange={(e) => setDailyBudgetCents(parseInt(e.target.value) || 0)} className={inputCls + ' font-mono'} />
              <p className={helpCls}>{dailyBudgetCents > 0 ? `${dailyBudgetCents.toLocaleString()} tokens/day limit` : 'No daily limit — local inference has no cost'}</p>
            </div>
            <div>
              <label className={labelCls}>Max Tool Loops Per Message</label>
              <input type="number" min={1} max={20} value={maxApiCallsPerMessage} onChange={(e) => setMaxApiCallsPerMessage(parseInt(e.target.value) || 6)} className={inputCls + ' font-mono'} />
              <p className={helpCls}>Limits the agentic tool-calling loop per user message to prevent runaway inference.</p>
            </div>
            <ToggleRow label="Output sanitization (PII/prompt leak detection)" checked={outputSanitization} onChange={setOutputSanitization} />
          </div>
        </Card>
      )}

      {/* Save Button (always visible) */}
      <div className="flex items-center gap-2 sticky bottom-6">
        <Button
          variant="primary"
          size="sm"
          icon={saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          loading={saving}
          onClick={handleSaveConfig}
        >
          {saved ? 'Saved!' : 'Save All Settings'}
        </Button>
        {saveError && (
          <span className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1">
            <XCircle className="w-3 h-3" /> {saveError}
          </span>
        )}
      </div>
    </div>
  );
}

// --- Helper: Toggle Row ---
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer py-1">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? 'bg-[var(--color-brand)]' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
      </button>
      <span className="text-[12px] text-[var(--color-text-secondary)]">{label}</span>
    </label>
  );
}
