'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Settings,
  ScrollText,
  BarChart3,
  Shield,
  Activity,
} from 'lucide-react';
import { useAgentStatus } from '@/lib/hooks';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/usage', label: 'Usage', icon: BarChart3 },
  { href: '/logs', label: 'Logs', icon: ScrollText },
  { href: '/permissions', label: 'Permissions', icon: Shield },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: agentStatus } = useAgentStatus();

  return (
    <aside
      role="navigation"
      aria-label="Main navigation"
      className="titlebar-no-drag w-[var(--sidebar-width)] min-w-[var(--sidebar-width)] h-screen flex flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] pt-[52px] pb-4"
    >
      {/* Agent status indicator */}
      <div className="px-4 mb-4">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-bg-tertiary)]">
          <Activity className="w-4 h-4" aria-hidden="true" />
          <span className="text-xs font-medium flex-1">Agent</span>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              agentStatus?.isRunning
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-[var(--color-text-tertiary)]'
            }`}
            role="status"
            aria-live="polite"
            aria-label={`Agent is ${agentStatus?.isRunning ? 'running' : 'stopped'}`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                agentStatus?.isRunning
                  ? 'bg-emerald-500 animate-pulse'
                  : 'bg-gray-400 dark:bg-gray-600'
              }`}
              aria-hidden="true"
            />
            {agentStatus?.isRunning ? 'Running' : 'Stopped'}
          </span>
        </div>
      </div>

      {/* Navigation links */}
      <nav className="flex-1 px-3 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 ${
                isActive
                  ? 'bg-[var(--color-brand)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)]'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* App version footer */}
      <div className="px-4 mt-auto">
        <p className="text-[11px] text-[var(--color-text-tertiary)] text-center">
          TextMyAgent v1.6.0
        </p>
      </div>
    </aside>
  );
}
