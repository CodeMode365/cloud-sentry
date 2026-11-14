import type { CloudAccount } from '@cloudsentry/shared-types';
import { ENTITY, keys } from '../keys';
import type { Table } from '../table';

export interface AccountRepository {
  create(account: CloudAccount): Promise<void>;
  get(tenantId: string, accountId: string): Promise<CloudAccount | null>;
  list(tenantId: string): Promise<CloudAccount[]>;
  update(
    tenantId: string,
    accountId: string,
    changes: Partial<Omit<CloudAccount, 'tenantId' | 'accountId' | 'externalId' | 'createdAt' | 'version'>>,
    expectedVersion?: number,
  ): Promise<CloudAccount>;
  delete(tenantId: string, accountId: string): Promise<void>;
}

export class DynamoAccountRepository implements AccountRepository {
  constructor(private readonly table: Table) {}

  create(account: CloudAccount): Promise<void> {
    return this.table.create(
      { ...keys.account(account.tenantId, account.accountId), entity: ENTITY.account, ...account },
      `AWS account ${account.accountId} is already registered`,
    );
  }

  get(tenantId: string, accountId: string): Promise<CloudAccount | null> {
    return this.table.get<CloudAccount>(keys.account(tenantId, accountId));
  }

  list(tenantId: string): Promise<CloudAccount[]> {
    return this.table.queryAll<CloudAccount>(
      { pk: keys.account(tenantId, '').PK, skPrefix: keys.accountPrefix },
      1000,
    );
  }

  update(
    tenantId: string,
    accountId: string,
    changes: Partial<CloudAccount>,
    expectedVersion?: number,
  ): Promise<CloudAccount> {
    return this.table.patch<CloudAccount>(
      keys.account(tenantId, accountId),
      changes,
      expectedVersion === undefined ? {} : { expectedVersion },
    );
  }

  async delete(tenantId: string, accountId: string): Promise<void> {
    await this.table.delete(keys.account(tenantId, accountId));
  }
}
