import useSWR from 'swr';
import * as api from './api';

const fetcher = <T>(fn: () => Promise<T>) => fn();

// Shared config: limit retries when backend is down to avoid flooding
const RETRY_OPTS = { errorRetryCount: 3, errorRetryInterval: 5000 };

export function useStatus() {
  return useSWR('status', () => fetcher(() => api.getStatus()), { refreshInterval: 5000, ...RETRY_OPTS });
}

export function useAgentStatus() {
  return useSWR('agent-status', () => fetcher(() => api.getAgentStatus()), { refreshInterval: 3000, ...RETRY_OPTS });
}

export function useConfig() {
  return useSWR('config', () => fetcher(() => api.getConfig()), RETRY_OPTS);
}

export function useSetupStatus() {
  return useSWR('setup-status', () => fetcher(() => api.getSetupStatus()), RETRY_OPTS);
}

export function usePermissions() {
  return useSWR('permissions', () => fetcher(() => api.getPermissions()), { refreshInterval: 5000, ...RETRY_OPTS });
}

export function useUsers() {
  return useSWR('users', () => fetcher(() => api.getUsers()));
}

export function useMessages(limit = 50, offset = 0) {
  return useSWR(`messages-${limit}-${offset}`, () => fetcher(() => api.getMessages(limit, offset)));
}

export function useUserMessages(userId: string | null, limit = 50) {
  return useSWR(
    userId ? `user-messages-${userId}-${limit}` : null,
    () => fetcher(() => api.getUserMessages(userId!, limit))
  );
}

export function useUsage(period: 'day' | 'week' | 'month' = 'day') {
  return useSWR(`usage-${period}`, () => fetcher(() => api.getUsage(period)));
}

export function useLogs(level?: string, search?: string) {
  return useSWR(`logs-${level}-${search}`, () => fetcher(() => api.getLogs(level, search)));
}

export function useSecurityEvents(severity?: string, limit = 50) {
  return useSWR(`security-events-${severity}-${limit}`, () => fetcher(() => api.getSecurityEvents(severity, limit)), { refreshInterval: 10000, ...RETRY_OPTS });
}

export function useSecurityConfig() {
  return useSWR('security-config', () => fetcher(() => api.getSecurityConfig()), RETRY_OPTS);
}

export function useBudgetStatus() {
  return useSWR('budget-status', () => fetcher(() => api.getBudgetStatus()), { refreshInterval: 10000, ...RETRY_OPTS });
}

export function useBlockedUsers() {
  return useSWR('blocked-users', () => fetcher(() => api.getBlockedUsers()), RETRY_OPTS);
}

export function useMemoryStats() {
  return useSWR('memory-stats', () => fetcher(() => api.getMemoryStats()), { refreshInterval: 15000, ...RETRY_OPTS });
}

export function useToolDefinitions() {
  return useSWR('tool-definitions', () => fetcher(() => api.getToolDefinitions()), RETRY_OPTS);
}

export function useToolExecutions(limit = 50) {
  return useSWR(`tool-executions-${limit}`, () => fetcher(() => api.getToolExecutions(limit)), { refreshInterval: 10000, ...RETRY_OPTS });
}

export function useReminders(status?: string) {
  return useSWR(`reminders-${status}`, () => fetcher(() => api.getReminders(status)), { refreshInterval: 10000, ...RETRY_OPTS });
}

export function useTriggers() {
  return useSWR('triggers', () => fetcher(() => api.getTriggers()), { refreshInterval: 10000, ...RETRY_OPTS });
}
