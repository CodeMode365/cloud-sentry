'use client';

import { create } from 'zustand';
import type { Tenant, UserProfile } from '@cloudsentry/shared-types';

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';

interface SessionState {
  status: SessionStatus;
  /** Held in memory only. The refresh token lives in an httpOnly cookie the page cannot read. */
  accessToken: string | null;
  expiresAt: number | null;
  user: UserProfile | null;
  tenant: Tenant | null;
  setSession: (input: {
    accessToken: string;
    expiresIn: number;
    user?: UserProfile;
    tenant?: Tenant;
  }) => void;
  setIdentity: (user: UserProfile, tenant: Tenant) => void;
  clearSession: () => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'unknown',
  accessToken: null,
  expiresAt: null,
  user: null,
  tenant: null,
  setSession: ({ accessToken, expiresIn, user, tenant }) =>
    set((state) => ({
      status: 'authenticated',
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
      user: user ?? state.user,
      tenant: tenant ?? state.tenant,
    })),
  setIdentity: (user, tenant) => set({ user, tenant }),
  clearSession: () =>
    set({ status: 'anonymous', accessToken: null, expiresAt: null, user: null, tenant: null }),
}));
