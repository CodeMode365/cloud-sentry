import type { UserRole } from '@cloudsentry/shared-types';
import { useSession } from './auth-store';

/** Mirrors the API's role model: VIEWER read-only; MEMBER operates; ADMIN/OWNER manage configuration. */
export function canOperate(role: UserRole | undefined): boolean {
  return role === 'MEMBER' || role === 'ADMIN' || role === 'OWNER';
}

export function canManage(role: UserRole | undefined): boolean {
  return role === 'ADMIN' || role === 'OWNER';
}

export function usePermissions(): { role: UserRole | undefined; canOperate: boolean; canManage: boolean } {
  const role = useSession((s) => s.user?.role);
  return { role, canOperate: canOperate(role), canManage: canManage(role) };
}
