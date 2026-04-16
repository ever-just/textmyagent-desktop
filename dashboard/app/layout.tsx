'use client';

import './globals.css';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useSetupStatus } from '@/lib/hooks';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const pathname = usePathname();
  const router = useRouter();
  const { data: setup } = useSetupStatus();
  const isSetupPage = pathname === '/setup';

  useEffect(() => {
    // Detect system theme
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setTheme(mq.matches ? 'dark' : 'light');
    const handler = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Redirect to /setup if the app is not configured and user is not already there
  useEffect(() => {
    if (!setup) return;
    if (!setup.needsSetup) {
      // Setup complete — clear any previous skip flag
      try { localStorage.removeItem('setup-skipped'); } catch {}
      return;
    }
    const skipped = typeof window !== 'undefined' && localStorage.getItem('setup-skipped');
    if (!skipped && !isSetupPage) {
      router.replace('/setup');
    }
  }, [setup, isSetupPage, router]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="bg-[var(--color-bg)] text-[var(--color-text)]">
        {/* WCAG 2.4.1: Skip to main content */}
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>

        <div className="flex h-screen">
          {/* macOS title bar drag region */}
          <div className="titlebar-drag fixed top-0 left-0 right-0 h-[38px] z-50" />

          {!isSetupPage && <Sidebar />}

          <main
            id="main-content"
            role="main"
            className="flex-1 overflow-y-auto pt-[38px]"
            tabIndex={-1}
          >
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </main>
        </div>
      </body>
    </html>
  );
}
