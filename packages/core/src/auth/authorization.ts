import type { AuthContext, UserRole } from '@cloudsentry/shared-types';
import { ForbiddenError } from '@cloudsentry/utilities';

const ROLE_RANK: Record<UserRole, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

/**
 * Role model: VIEWER read-only; MEMBER may run scans, triage findings/recommendations, create reports;
 * ADMIN/OWNER may additionally manage accounts, schedules and settings.
 */
export function requireRole(ctx: AuthContext, minimum: UserRole): void {
  if (ROLE_RANK[ctx.role] < ROLE_RANK[minimum]) {
    throw new ForbiddenError(`This action requires the ${minimum} role or higher`);
  }
}

export function hasRole(ctx: AuthContext, minimum: UserRole): boolean {
  return ROLE_RANK[ctx.role] >= ROLE_RANK[minimum];
}
