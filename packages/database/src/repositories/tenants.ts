import type { Tenant, UserProfile } from '@cloudsentry/shared-types';
import { ConflictError, epochSeconds, addDays } from '@cloudsentry/utilities';
import { ENTITY, keys } from '../keys';
import { isTransactionConditionFailure, type Table } from '../table';

export interface PendingRegistration {
  email: string;
  name: string;
  organizationName: string;
  createdAt: string;
}

export interface TenantRepository {
  getTenant(tenantId: string): Promise<Tenant | null>;
  getUserProfile(userId: string): Promise<UserProfile | null>;
  /** Atomically creates a tenant and its first (owner) user. */
  provisionTenant(tenant: Tenant, owner: UserProfile): Promise<void>;
  recordLogin(userId: string, at: string): Promise<void>;
  savePendingRegistration(registration: PendingRegistration, ttlDays: number): Promise<void>;
  getPendingRegistration(email: string): Promise<PendingRegistration | null>;
  deletePendingRegistration(email: string): Promise<void>;
  listUsers(tenantId: string): Promise<UserProfile[]>;
}

export class DynamoTenantRepository implements TenantRepository {
  constructor(private readonly table: Table) {}

  getTenant(tenantId: string): Promise<Tenant | null> {
    return this.table.get<Tenant>(keys.tenant(tenantId));
  }

  getUserProfile(userId: string): Promise<UserProfile | null> {
    return this.table.get<UserProfile>(keys.user(userId));
  }

  async provisionTenant(tenant: Tenant, owner: UserProfile): Promise<void> {
    try {
      await this.table.transact([
        {
          Put: {
            TableName: this.table.tableName,
            Item: { ...keys.tenant(tenant.tenantId), entity: ENTITY.tenant, ...tenant },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.table.tableName,
            Item: {
              ...keys.user(owner.userId),
              ...keys.userGsi(owner.tenantId, owner.userId),
              entity: ENTITY.user,
              ...owner,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ]);
    } catch (error) {
      if (isTransactionConditionFailure(error))
        throw new ConflictError('User or tenant is already provisioned');
      throw error;
    }
  }

  async recordLogin(userId: string, at: string): Promise<void> {
    await this.table.update({
      key: keys.user(userId),
      updateExpression: 'SET lastLoginAt = :at',
      values: { ':at': at },
      condition: 'attribute_exists(PK)',
    });
  }

  async savePendingRegistration(registration: PendingRegistration, ttlDays: number): Promise<void> {
    await this.table.put({
      ...keys.registration(registration.email),
      entity: ENTITY.registration,
      ...registration,
      expiresAt: epochSeconds(addDays(new Date(), ttlDays)),
    });
  }

  async getPendingRegistration(email: string): Promise<PendingRegistration | null> {
    const raw = await this.table.getRaw(keys.registration(email));
    if (!raw) return null;
    // TTL deletion is eventual; treat expired items as absent.
    if (typeof raw.expiresAt === 'number' && raw.expiresAt < epochSeconds(new Date())) return null;
    return {
      email: raw.email,
      name: raw.name,
      organizationName: raw.organizationName,
      createdAt: raw.createdAt,
    };
  }

  async deletePendingRegistration(email: string): Promise<void> {
    await this.table.delete(keys.registration(email));
  }

  listUsers(tenantId: string): Promise<UserProfile[]> {
    return this.table.queryAll<UserProfile>({ pk: keys.userGsi(tenantId, '').GSI1PK, index: 'GSI1' });
  }
}
