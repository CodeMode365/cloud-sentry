'use client';

import Link from 'next/link';
import { LogOut, Settings, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSession } from '@/lib/auth-store';
import { titleCase } from '@/lib/format';
import { useLogout } from './session';

export function UserMenu() {
  const user = useSession((s) => s.user);
  const tenant = useSession((s) => s.tenant);
  const logout = useLogout();
  const initials = (user?.name ?? user?.email ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2" aria-label="Open user menu">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {initials}
          </span>
          <span className="hidden max-w-40 truncate text-sm md:inline">{user?.name ?? user?.email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="space-y-0.5">
          <div className="truncate">{user?.name}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">{user?.email}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">
            {tenant?.name} · {user ? titleCase(user.role) : ''}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/?tab=profile">
            <UserRound /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/">
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
