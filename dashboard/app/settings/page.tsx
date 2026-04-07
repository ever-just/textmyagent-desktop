'use client';

import { useState, useEffect } from 'react';
import { useConfig } from '@/lib/hooks';
import { updateConfig, saveApiKey, testAnthropic } from '@/lib/api';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Save, Key, TestTube, CheckCircle2, XCircle, Info } from 'lucide-react';

export default function SettingsPage() {
  const { data: config, error, mutate } = useConfig();

  // Form state
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [contextWindow, setContextWindow] = useState(100000);
  const [apiKey, setApiKey] = useState('');

  // UI state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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
    }
  }, [config]);

  const handleSaveConfig = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await updateConfig({
        'anthropic.model': model,
        'anthropic.temperature': temperature,
        'anthropic.responseMaxTokens': maxTokens,
        'anthropic.contextWindowTokens': contextWindow,
      });
      await mutate();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      alert(err.message);
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

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="Settings" description="Configure your AI agent and application preferences" />

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
            <label htmlFor="api-key" className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1">
              API Key
            </label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config.anthropic.hasApiKey ? '••••••••  (already configured)' : 'sk-ant-...'}
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)] outline-none transition-colors font-mono"
              autoComplete="off"
              aria-describedby="api-key-help"
            />
            <p id="api-key-help" className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
              Get your API key from <span className="font-medium">console.anthropic.com</span>. Keys start with sk-ant-
            </p>
          </div>
          {apiKeyError && (
            <p className="text-[12px] text-red-600 dark:text-red-400" role="alert">{apiKeyError}</p>
          )}
          {testResult && (
            <div
              className={`flex items-center gap-2 text-[12px] p-2 rounded-lg ${
                testResult.success
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                  : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'
              }`}
              role="alert"
            >
              {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {testResult.success ? 'API key is valid and working' : testResult.error || 'API key test failed'}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<TestTube className="w-3.5 h-3.5" />}
              loading={testing}
              onClick={handleTestApi}
            >
              Test Connection
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Save className="w-3.5 h-3.5" />}
              loading={apiKeySaving}
              onClick={handleSaveApiKey}
              disabled={!apiKey.trim()}
            >
              Save Key
            </Button>
          </div>
        </div>
      </Card>

      {/* Model Configuration */}
      <Card className="mb-6">
        <h2 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
          <Info className="w-4 h-4" aria-hidden="true" />
          AI Model Configuration
        </h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="model" className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1">
              Model
            </label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)] outline-none"
            >
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4 (Recommended)</option>
              <option value="claude-3-5-haiku-latest">Claude 3.5 Haiku (Fast)</option>
              <option value="claude-3-5-sonnet-latest">Claude 3.5 Sonnet</option>
            </select>
            <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
              Haiku is faster and cheaper. Sonnet is more capable for complex conversations.
            </p>
          </div>

          <div>
            <label htmlFor="temperature" className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1">
              Temperature: {temperature}
            </label>
            <input
              id="temperature"
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-[var(--color-brand)]"
              aria-describedby="temp-help"
            />
            <p id="temp-help" className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
              Lower = more focused and deterministic. Higher = more creative and varied.
            </p>
          </div>

          <div>
            <label htmlFor="max-tokens" className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1">
              Max Response Tokens
            </label>
            <input
              id="max-tokens"
              type="number"
              min={100}
              max={8192}
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value) || 1024)}
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)] outline-none font-mono"
              aria-describedby="tokens-help"
            />
            <p id="tokens-help" className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
              Maximum length of each AI response. 1 token ≈ 4 characters. Range: 100–8,192.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button
              variant="primary"
              size="sm"
              icon={saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              loading={saving}
              onClick={handleSaveConfig}
            >
              {saved ? 'Saved!' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
