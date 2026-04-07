interface StatusBadgeProps {
  status: 'online' | 'offline' | 'error' | 'warning' | 'running' | 'stopped' | 'granted' | 'denied' | 'not_determined' | 'unknown';
  label?: string;
  size?: 'sm' | 'md';
}

const STATUS_STYLES: Record<string, { dot: string; text: string; bg: string }> = {
  online:         { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  running:        { dot: 'bg-emerald-500 animate-pulse', text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  granted:        { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  offline:        { dot: 'bg-gray-400', text: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-900/30' },
  stopped:        { dot: 'bg-gray-400', text: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-900/30' },
  not_determined: { dot: 'bg-amber-400', text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30' },
  unknown:        { dot: 'bg-gray-400', text: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-900/30' },
  warning:        { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30' },
  error:          { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/30' },
  denied:         { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/30' },
};

const LABELS: Record<string, string> = {
  online: 'Online', offline: 'Offline', error: 'Error', warning: 'Warning',
  running: 'Running', stopped: 'Stopped', granted: 'Granted', denied: 'Denied',
  not_determined: 'Pending', unknown: 'Unknown',
};

export function StatusBadge({ status, label, size = 'sm' }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.unknown;
  const displayLabel = label || LABELS[status] || status;
  const isSmall = size === 'sm';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${style.bg} ${style.text} ${
        isSmall ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
      }`}
      role="status"
      aria-label={displayLabel}
    >
      <span className={`rounded-full flex-shrink-0 ${style.dot} ${isSmall ? 'w-1.5 h-1.5' : 'w-2 h-2'}`} aria-hidden="true" />
      {displayLabel}
    </span>
  );
}
