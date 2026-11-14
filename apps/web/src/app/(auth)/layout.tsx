'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Brand } from '@/components/layout/brand';
import { useBootstrapSession } from '@/components/layout/session';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { useSession } from '@/lib/auth-store';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  useBootstrapSession();
  const status = useSession((s) => s.status);
  const router = useRouter();
  React.useEffect(() => {
    if (status === 'authenticated') {
      const next = new URLSearchParams(window.location.search).get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    }
  }, [status, router]);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Brand />
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="px-4 py-4 text-center text-xs text-muted-foreground">
        Find cloud waste. Understand the impact. Optimize with confidence.
      </footer>
    </div>
  );
}
