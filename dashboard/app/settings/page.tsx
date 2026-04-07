'use client';

import { useState, useEffect } from 'react';
import { useConfig } from '@/lib/hooks';
import { updateConfig, saveApiKey, testAnthropic } from '@/lib/api';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Save, Key, TestTube, CheckCircle2, XCircle, Info, User, Shield, Wrench, Brain, Clock } from 'lucide-react';

type SettingsTab = 'general' | 'persona' | 'tools' | 'memory' | 'security';

export default function SettingsPage() {
  const { data: config, error, mutate } = useConfig();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  // General form state
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [contextWindow, setContextWindow] = useState(100000);
  const [apiKey, setApiKey] = useState('');
  const [maxResponseChars, setMaxResponseChars] = useState(500);
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
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setModel(config.anthropic.model);
      setTemperature(config.anthropic.temperature);
      setMaxTokens(config.anthropic.responseMaxTokens);
      setContextWindow(config.anthropic.contextWindowTokens);
      // Load extended settings from config.settings if available
      const s = config.settings || {};
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
        // General
        'anthropic.model': model,
        'anthropic.temperature': temperature,
        'anthropic.responseMaxTokens': maxTokens,
        'anthropic.contextWindowTokens': contextWindow,
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

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) return;
    setApiKeySaving(true);
    setApiKeyError(null);
    try {
      await saveApiKey(apiKey.trim());
      setApiKey('');
      await mutate();
    } catch (err: any) {
      setApiKeyError(err.message);
    } finally {
      setApiKeySaving(false);
    }
  };

  const handleTestApi = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAnthropic(apiKey.trim() || undefined);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setTesting(false);
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
          {/* API Key Section */}
          <Card className="mb-6">
            <h2 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
              <Key className="w-4 h-4" aria-hidden="true" />
              Anthropic API Key
            </h2>
            <p className="text-[12px] text-[var(--color-text-secondary)] mb-3">
              Your API key is stored securely in the macOS Keychain. {config.anthropic.hasApiKey ? 'A key is currently configured.' : 'No key is configured yet.'}
            </p>
            <div className="space-y-3">
              <div>
                <label htmlFor="api-key" className={labelCls}>API Key</label>
                <input
                  id="api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={config.anthropic.hasApiKey ? '••••••••  (already configured)' : 'sk-ant-...'}
                  className={inputCls + ' font-mono'}
                  autoComplete="off"
                />
                <p className={helpCls}>Get your API key from console.anthropic.com</p>
              </div>
              {apiKeyError && <p className="text-[12px] text-red-600 dark:text-red-400" role="alert">{apiKeyError}</p>}
              {testResult && (
                <div className={`flex items-center gap-2 text-[12px] p-2 rounded-lg ${testResult.success ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'}`} role="alert">
                  {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {testResult.success ? 'API key is valid and working' : testResult.error || 'API key test failed'}
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" icon={<TestTube className="w-3.5 h-3.5" />} loading={testing} onClick={handleTestApi}>Test</Button>
                <Button variant="primary" size="sm" icon={<Save className="w-3.5 h-3.5" />} loading={apiKeySaving} onClick={handleSaveApiKey} disabled={!apiKey.trim()}>Save Key</Button>
              </div>
            </div>
          </Card>

          {/* Model Configuration */}
          <Card className="mb-6">
            <h2 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
              <Info className="w-4 h-4" aria-hidden="true" />
              AI Model
            </h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="model" className={labelCls}>Model</label>
                <select id="model" value={model} onChange={(e) => setModel(e.target.value)} className={inputCls}>
                  <option value="claude-sonnet-4-20250514">Claude Sonnet 4 (Recommended)</option>
                  <option value="claude-3-5-haiku-latest">Claude 3.5 Haiku (Fast)</option>
                  <option value="claude-3-5-sonnet-latest">Claude 3.5 Sonnet</option>
                </select>
              </div>
              <div>
                <label htmlFor="temperature" className={labelCls}>Temperature: {temperature}</label>
                <input id="temperature" type="range" min="0" max="1" step="0.1" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="w-full accent-[var(--color-brand)]" />
                <p className={helpCls}>Lower = focused. Higher = creative.</p>
              </div>
              <div>
                <label htmlFor="max-tokens" className={labelCls}>Max Response Tokens</label>
                <input id="max-tokens" type="number" min={100} max={8192} value={maxTokens} onChange={(e) => setMaxTokens(parseInt(e.target.value) || 1024)} className={inputCls + ' font-mono'} />
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
                  <p className="text-[12px] font-medium text-[var(--color-text-secondary)] mb-2">Anthropic Server Tools</p>
                  <ToggleRow label="Web Search" checked={webSearch} onChange={setWebSearch} />
                  {webSearch && (
                    <div className="ml-6 mt-1">
                      <label className={labelCls}>Max uses per message</label>
                      <input type="number" min={1} max={10} value={webSearchMaxUses} onChange={(e) => setWebSearchMaxUses(parseInt(e.target.value) || 3)} className={inputCls + ' font-mono w-24'} />
                    </div>
                  )}
                </div>
                <div className="border-t border-[var(--color-border)] pt-3">
                  <p className="text-[12px] font-medium text-[var(--color-text-secondary)] mb-2">Custom Tools</p>
                  <ToggleRow label="Save User Fact" checked={saveUserFact} onChange={setSaveUserFact} />
                  <ToggleRow label="Get User Facts" checked={getUserFacts} onChange={setGetUserFacts} />
                  <ToggleRow label="Search History" checked={searchHistory} onChange={setSearchHistory} />
                  <ToggleRow label="Reminders" checked={reminders} onChange={setReminders} />
                  <ToggleRow label="Triggers" checked={triggers} onChange={setTriggers} />
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
              <label className={labelCls}>Daily Budget (cents, 0 = unlimited)</label>
              <input type="number" min={0} max={100000} value={dailyBudgetCents} onChange={(e) => setDailyBudgetCents(parseInt(e.target.value) || 0)} className={inputCls + ' font-mono'} />
              <p className={helpCls}>{dailyBudgetCents > 0 ? `$${(dailyBudgetCents / 100).toFixed(2)}/day` : 'No daily limit'}</p>
            </div>
            <div>
              <label className={labelCls}>Max API Calls Per Message</label>
              <input type="number" min={1} max={20} value={maxApiCallsPerMessage} onChange={(e) => setMaxApiCallsPerMessage(parseInt(e.target.value) || 6)} className={inputCls + ' font-mono'} />
              <p className={helpCls}>Limits the tool-calling loop to prevent runaway costs.</p>
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
