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
    model: {
      name: string;
      temperature: number;
      responseMaxTokens: number;
      contextSize: number;
      gpuLayers: number;
      status: string;
      isDownloaded: boolean;
      isLoaded: boolean;
    };
    imessage: { configured: boolean; sendEnabled: boolean; error?: string };
    app: { version: string; platform: string; arch: string };
    settings: Record<string, any>;
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
    steps: { modelDownloaded: boolean; fullDiskAccess: boolean; automation: boolean; contacts: boolean };
    permissions: { allGranted: boolean; requiredGranted: boolean; details: Permission[] };
    needsSetup: boolean;
  }>('/setup/status');
}

// --- Model Management ---
export async function getModelStatus() {
  return request<{
    status: string;
    isDownloaded: boolean;
    isLoaded: boolean;
    downloadProgress: number;
    errorMessage?: string;
  }>('/model/status');
}

export async function startModelDownload() {
  return request<{ success: boolean; message?: string }>('/model/download', { method: 'POST' });
}

export async function loadModel() {
  return request<{ success: boolean }>('/model/load', { method: 'POST' });
}

export async function testModel() {
  return request<{ success: boolean; error?: string }>('/setup/test-model', { method: 'POST' });
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

// --- Memory ---
export interface UserFact {
  id: string;
  userId: string;
  type: 'preference' | 'personal' | 'behavioral' | 'general';
  content: string;
  source: string;
  confidence: number;
  lastUsedAt: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface MemoryStats {
  totalFacts: number;
  totalSummaries: number;
  factsByType: Record<string, number>;
  userCount: number;
}

export async function getMemoryStats() {
  return request<MemoryStats>('/memory/stats');
}

export async function getUserFacts(userId: string, type?: string) {
  const params = new URLSearchParams({ userId });
  if (type) params.set('type', type);
  return request<{ facts: UserFact[] }>(`/memory/facts?${params}`);
}

export async function saveFact(userId: string, content: string, type?: string) {
  return request<{ fact: UserFact }>('/memory/facts', {
    method: 'POST',
    body: JSON.stringify({ userId, content, type: type || 'general' }),
  });
}

export async function deleteFact(factId: string) {
  return request<{ success: boolean }>(`/memory/facts/${factId}`, { method: 'DELETE' });
}

export async function purgeUserFacts(userId: string) {
  return request<{ success: boolean; deletedCount: number }>(`/memory/facts/user/${userId}`, { method: 'DELETE' });
}

export async function expireOldFacts() {
  return request<{ success: boolean; expiredCount: number }>('/memory/expire', { method: 'POST' });
}

export async function exportFacts(userId?: string) {
  const params = userId ? `?userId=${userId}` : '';
  return request<any>(`/memory/export${params}`);
}

// --- Security ---
export interface SecurityEvent {
  id: number;
  eventType: string;
  userHandle: string | null;
  details: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  createdAt: string;
}

export interface BudgetStatus {
  dailyBudgetCents: number;
  spentCents: number;
  inputTokens: number;
  outputTokens: number;
  isExceeded: boolean;
  percentUsed: number;
}

export interface SecurityConfig {
  rateLimitPerMinute: number;
  rateLimitGlobalPerHour: number;
  dailyBudgetCents: number;
  maxApiCallsPerMessage: number;
  outputSanitization: boolean;
}

export async function getSecurityEvents(severity?: string, limit = 50, offset = 0) {
  const params = new URLSearchParams();
  if (severity && severity !== 'all') params.set('severity', severity);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return request<{ events: SecurityEvent[]; total: number }>(`/security/events?${params}`);
}

export async function getSecurityConfig() {
  return request<SecurityConfig>('/security/config');
}

export async function getBudgetStatus() {
  return request<BudgetStatus>('/security/budget');
}

export async function getBlockedUsers() {
  return request<{ users: User[] }>('/security/blocked-users');
}

export async function blockUser(userId: string) {
  return request<{ success: boolean }>(`/security/users/${userId}/block`, { method: 'POST' });
}

export async function unblockUser(userId: string) {
  return request<{ success: boolean }>(`/security/users/${userId}/unblock`, { method: 'POST' });
}

// --- Tools ---
export interface ToolDefinition {
  name: string;
  description: string;
  type: 'custom';
  enabled: boolean;
}

export interface ToolExecution {
  id: string;
  toolName: string;
  userId: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
  durationMs: number;
  tokensUsed: number;
  createdAt: string;
}

export interface Reminder {
  id: string;
  user_id: string;
  chat_guid: string;
  message: string;
  due_at: string;
  is_sent: number;
  created_at: string;
}

export interface Trigger {
  id: string;
  user_id: string;
  chat_guid: string;
  name: string;
  message: string;
  schedule: string;
  is_active: number;
  last_fired_at: string | null;
  created_at: string;
}

export async function getToolDefinitions() {
  return request<{ tools: ToolDefinition[] }>('/tools/definitions');
}

export async function getToolExecutions(limit = 50) {
  return request<{ executions: ToolExecution[] }>(`/tools/executions?limit=${limit}`);
}

export async function getReminders(status?: string) {
  const params = status ? `?status=${status}` : '';
  return request<{ reminders: Reminder[] }>(`/tools/reminders${params}`);
}

export async function deleteReminder(id: string) {
  return request<{ success: boolean }>(`/tools/reminders/${id}`, { method: 'DELETE' });
}

export async function getTriggers() {
  return request<{ triggers: Trigger[] }>('/tools/triggers');
}

export async function toggleTrigger(id: string) {
  return request<{ success: boolean; isActive: boolean }>(`/tools/triggers/${id}/toggle`, { method: 'POST' });
}

export async function deleteTrigger(id: string) {
  return request<{ success: boolean }>(`/tools/triggers/${id}`, { method: 'DELETE' });
}

export async function openSettings(settingsUrl: string) {
  return request<{ success: boolean }>('/settings/open', {
    method: 'POST',
    body: JSON.stringify({ settingsUrl }),
  });
}
