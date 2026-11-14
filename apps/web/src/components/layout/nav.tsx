'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CircleDollarSign,
  Cloud,
  FileText,
  History,
  LayoutDashboard,
  Lightbulb,
  Server,
  Settings,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const NAV_ITEMS = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/accounts/', label: 'Cloud Accounts', icon: Cloud },
  { href: '/resources/', label: 'Resources', icon: Server },
  { href: '/costs/', label: 'Cost Analytics', icon: CircleDollarSign },
  { href: '/findings/', label: 'Findings', icon: TriangleAlert },
  { href: '/recommendations/', label: 'Recommendations', icon: Lightbulb },
  { href: '/scans/', label: 'Scan History', icon: History },
  { href: '/reports/', label: 'Reports', icon: FileText },
  { href: '/settings/', label: 'Settings', icon: Settings },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href) || `${pathname}/`.startsWith(href);
}

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? '/';
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
              active && 'bg-sidebar-accent text-sidebar-accent-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
