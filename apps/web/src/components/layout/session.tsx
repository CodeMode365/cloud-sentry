'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { refreshSession, request } from '@/lib/api';
import { useSession } from '@/lib/auth-store';

/** Restores the session from the httpOnly refresh cookie on first load. */
export function useBootstrapSession(): void {
  const status = useSession((s) => s.status);
  const started = React.useRef(false);
  React.useEffect(() => {
    if (status !== 'unknown' || started.current) return;
    started.current = true;
    void refreshSession().then((ok) => {
      if (!ok) useSession.getState().clearSession();
    });
  }, [status]);
}

export function useLogout(): () => Promise<void> {
  const router = useRouter();
  const queryClient = useQueryClient();
  return React.useCallback(async () => {
    try {
      await request<void>('POST', '/auth/logout', {
        noAuthRetry: true,
        headers: { 'X-CloudSentry-Client': 'web' },
      });
    } catch {
      // Logging out locally must succeed even if the API is unreachable.
    }
    useSession.getState().clearSession();
    queryClient.clear();
    router.replace('/login/');
  }, [queryClient, router]);
}
