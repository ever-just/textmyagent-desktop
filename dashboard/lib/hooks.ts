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
