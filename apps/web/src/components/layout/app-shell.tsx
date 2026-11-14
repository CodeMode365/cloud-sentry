'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FlaskConical, LoaderCircle, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useSession } from '@/lib/auth-store';
import { useAccounts } from '@/lib/queries';
import { Brand } from './brand';
import { NavLinks } from './nav';
import { useBootstrapSession } from './session';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

function SyntheticDataBanner() {
  const accounts = useAccounts();
  const synthetic = (accounts.data ?? []).filter((a) => a.dataSource === 'SYNTHETIC');
  if (synthetic.length === 0) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-dashed border-warning bg-warning/12 px-4 py-2 text-xs text-warning-foreground dark:text-warning"
    >
      <FlaskConical className="size-4 shrink-0" aria-hidden />
      <span>
        <strong>Synthetic data present.</strong> {synthetic.length} account
        {synthetic.length === 1 ? ' contains' : 's contain'} locally generated sample data (
        {synthetic.map((a) => a.alias).join(', ')}). It is not real AWS data.
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  useBootstrapSession();
  const status = useSession((s) => s.status);
  const tenant = useSession((s) => s.tenant);
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    if (status === 'anonymous') {
      const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
      router.replace(`/login/${next}`);
    }
  }, [status, router, pathname]);

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy="true">
        <LoaderCircle className="size-6 animate-spin text-muted-foreground" aria-label="Loading session" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <Link
            href="/"
            className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Brand />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks />
        </div>
        <div className="border-t border-sidebar-border p-4 text-xs text-muted-foreground">
          <div className="truncate font-medium text-sidebar-foreground">{tenant?.name}</div>
          <div>Read-only optimization</div>
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-14 items-center border-b border-sidebar-border px-4">
            <Brand />
          </div>
          <div className="p-3">
            <NavLinks onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <div className="lg:hidden">
            <Brand compact />
          </div>
          <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            <span className="hidden sm:inline">{tenant?.name}</span>
          </div>
          <ThemeToggle />
          <UserMenu />
        </header>
        <SyntheticDataBanner />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
