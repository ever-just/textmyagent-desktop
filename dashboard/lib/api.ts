function getApiBase(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3001/api/dashboard';
  // In dev mode, Next.js runs on :3000 but backend is on :3001
  // In production, frontend is served by the backend on the same origin
  const port = window.location.port;
  if (port === '3000') {
    return 'http://127.0.0.1:3001/api/dashboard';
  }
  return `${window.location.origin}/api/dashboard`;
}

const API_BASE = getApiBase();

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// --- Status ---
export async function getStatus() {
  return request<{
    agent: { status: string; uptime: number; memory: number; version: string };
    database: { status: string };
    imessage: { status: string; configured: boolean; error?: string };
    configured: boolean;
  }>('/status');
}

// --- Agent ---
export async function getAgentStatus() {
  return request<{
    isRunning: boolean;
    isConnected: boolean;
    activeConversations: number;
    processingCount: number;
  }>('/agent/status');
}

export async function startAgent() {
  return request<{ success: boolean; message?: string; error?: string }>('/agent/start', { method: 'POST' });
}

export async function stopAgent() {
  return request<{ success: boolean; message?: string; error?: string }>('/agent/stop', { method: 'POST' });
}

export async function restartAgent() {
  return request<{ success: boolean; message?: string; error?: string }>('/agent/restart', { method: 'POST' });
}

// --- Config ---
export async function getConfig() {
  return request<{
    anthropic: {
      model: string;
      temperature: number;
      responseMaxTokens: number;
      contextWindowTokens: number;
      enableWebSearch: boolean;
      hasApiKey: boolean;
    };
    imessage: { configured: boolean; sendEnabled: boolean; error?: string };
    app: { version: string; platform: string; arch: string };
  }>('/config');
}

export async function updateConfig(updates: Record<string, unknown>) {
  return request<{ success: boolean }>('/config', {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

// --- Setup ---
export async function getSetupStatus() {
  return request<{
    isConfigured: boolean;
    steps: { apiKey: boolean; fullDiskAccess: boolean; automation: boolean; contacts: boolean };
    permissions: { allGranted: boolean; requiredGranted: boolean; details: Permission[] };
    needsSetup: boolean;
  }>('/setup/status');
}

export async function saveCredentials(anthropicApiKey: string) {
  return request<{ success: boolean; isConfigured: boolean }>('/setup/credentials', {
    method: 'POST',
    body: JSON.stringify({ anthropicApiKey }),
  });
}

export async function testAnthropic(apiKey?: string) {
  return request<{ success: boolean; error?: string }>('/setup/test-anthropic', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });
}

// --- Permissions ---
export interface Permission {
  id: string;
  name: string;
  description: string;
  status: 'granted' | 'denied' | 'not_determined' | 'unknown';
  required: boolean;
  settingsUrl?: string;
  instructions?: string;
}

export async function getPermissions() {
  return request<{
    allGranted: boolean;
    requiredGranted: boolean;
    permissions: Permission[];
    services: { id: string; name: string; status: string }[];
    apiKeys: { id: string; name: string; configured: boolean; masked?: string }[];
  }>('/permissions');
}

export async function openPermissionSettings(permissionId: string) {
  return request<{ success: boolean }>('/permissions/open-settings', {
    method: 'POST',
    body: JSON.stringify({ permissionId }),
  });
}

export async function requestAutomation() {
  return request<{ success: boolean; status: string }>('/permissions/request-automation', { method: 'POST' });
}

export async function requestContactsPermission() {
  return request<{ success: boolean; status: string }>('/contacts/request-permission', { method: 'POST' });
}

// --- Users ---
export interface User {
  id: string;
  handle: string;
  displayName: string;
  isBlocked: number;
  createdAt: string;
  conversationCount: number;
  lastMessageAt: string | null;
}

export async function getUsers() {
  return request<{ users: User[] }>('/users');
}

// --- Messages ---
export interface MessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  conversationId: string;
  userHandle?: string;
  userDisplayName?: string;
}

export async function getMessages(limit = 50, offset = 0) {
  return request<{ messages: MessageItem[] }>(`/messages/all?limit=${limit}&offset=${offset}`);
}

export async function getUserMessages(userId: string, limit = 50) {
  return request<{ messages: MessageItem[] }>(`/users/${userId}/messages?limit=${limit}`);
}

// --- Usage ---
export interface UsagePeriod {
  period: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
}

export async function getUsage(period: 'day' | 'week' | 'month' = 'day') {
  return request<{
    usage: UsagePeriod[];
    totals: { inputTokens: number; outputTokens: number; totalTokens: number; requestCount: number };
  }>(`/usage?period=${period}`);
}

// --- Logs ---
export interface LogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  metadata?: Record<string, unknown>;
}

export async function getLogs(level?: string, search?: string, limit = 100) {
  const params = new URLSearchParams();
  if (level && level !== 'all') params.set('level', level);
  if (search) params.set('search', search);
  params.set('limit', String(limit));
  return request<{ logs: LogEntry[] }>(`/logs?${params}`);
}

export function createLogStream(onMessage: (entry: LogEntry) => void, onError?: (err: Event) => void): EventSource {
  const url = `${API_BASE}/logs/stream`;
  const es = new EventSource(url);
  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type !== 'connected') {
        onMessage(data as LogEntry);
      }
    } catch { /* ignore parse errors */ }
  };
  es.onerror = (err) => onError?.(err);
  return es;
}

// --- Settings API Key ---
export async function saveApiKey(value: string) {
  return request<{ success: boolean }>('/settings/api-key', {
    method: 'POST',
    body: JSON.stringify({ key: 'ANTHROPIC_API_KEY', value }),
  });
}

export async function openSettings(settingsUrl: string) {
  return request<{ success: boolean }>('/settings/open', {
    method: 'POST',
    body: JSON.stringify({ settingsUrl }),
  });
}
