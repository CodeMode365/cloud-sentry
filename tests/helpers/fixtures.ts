/**
 * SYNTHETIC TEST FIXTURES for integration tests. Never used outside tests.
 */
import type { CloudAccount, Tenant, UserProfile, UserRole } from '@cloudsentry/shared-types';
import type { Repositories } from '@cloudsentry/database';

export const NOW = '2026-11-10T00:00:00.000Z';

export async function seedTenant(
  repos: Repositories,
  tenantId: string,
  userId: string,
  role: UserRole = 'OWNER',
) {
  const tenant: Tenant = { tenantId, name: `Tenant ${tenantId}`, createdAt: NOW, updatedAt: NOW };
  const user: UserProfile = {
    userId,
    tenantId,
    email: `${userId}@example.com`,
    name: userId,
    role,
    createdAt: NOW,
    lastLoginAt: null,
  };
  await repos.tenants.provisionTenant(tenant, user);
  return { tenant, user, auth: { userId, tenantId, role, email: user.email } };
}

export function account(
  tenantId: string,
  accountId: string,
  overrides: Partial<CloudAccount> = {},
): CloudAccount {
  return {
    tenantId,
    accountId,
    alias: `acct-${accountId}`,
    roleArn: `arn:aws:iam::${accountId}:role/CloudSentryReadOnlyRole`,
    externalId: `cs-ext-${accountId}`,
    regions: ['us-east-1'],
    status: 'CONNECTED',
    dataSource: 'AWS',
    connectionType: 'ROLE',
    organizationId: null,
    lastVerification: null,
    lastScanId: null,
    lastScanAt: null,
    lastSuccessfulScanAt: null,
    createdBy: 'u',
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}
