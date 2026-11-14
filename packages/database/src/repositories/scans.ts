import type {
  DiscoveryTypeResult,
  ScanError,
  ScanExecution,
  ScanStatus,
  ScanStepName,
  ScanStepState,
} from '@cloudsentry/shared-types';
import { epochSeconds } from '@cloudsentry/utilities';
import { ENTITY, keys, tenantPrefix } from '../keys';
import { isConditionFailure, type Page, type Table } from '../table';

export interface ScanListFilter {
  accountId?: string;
  status?: ScanStatus;
  limit: number;
  cursor?: string;
}

export interface ScanLock {
  scanId: string;
  acquiredAt: string;
  expiresAt: number;
}

export interface ScanRepository {
  create(scan: ScanExecution): Promise<void>;
  get(tenantId: string, scanId: string): Promise<ScanExecution | null>;
  list(tenantId: string, filter: ScanListFilter): Promise<Page<ScanExecution>>;
  listRecent(tenantId: string, limit: number): Promise<ScanExecution[]>;
  update(
    tenantId: string,
    scanId: string,
    changes: Partial<ScanExecution>,
    options?: { onlyIfStatusIn?: ScanStatus[] },
  ): Promise<ScanExecution>;
  setStep(tenantId: string, scanId: string, step: ScanStepName, state: ScanStepState): Promise<void>;
  appendErrors(tenantId: string, scanId: string, errors: ScanError[]): Promise<void>;
  setDiscovery(tenantId: string, scanId: string, discovery: DiscoveryTypeResult[]): Promise<void>;
  /** Returns true if the lock was acquired; false if another unexpired scan holds it. */
  acquireLock(
    tenantId: string,
    accountId: string,
    scanId: string,
    ttlSeconds: number,
    now: Date,
  ): Promise<boolean>;
  getLock(tenantId: string, accountId: string, now: Date): Promise<ScanLock | null>;
  releaseLock(tenantId: string, accountId: string, scanId: string): Promise<void>;
  /** Registers an idempotency key; returns the scanId already bound to it, or null if newly registered. */
  claimIdempotencyKey(
    tenantId: string,
    key: string,
    scanId: string,
    ttlSeconds: number,
    now: Date,
  ): Promise<string | null>;
  releaseIdempotencyKey(tenantId: string, key: string, scanId: string): Promise<void>;
}

export class DynamoScanRepository implements ScanRepository {
  constructor(private readonly table: Table) {}

  create(scan: ScanExecution): Promise<void> {
    return this.table.create(
      {
        ...keys.scan(scan.tenantId, scan.scanId),
        ...keys.scanGsi(scan.tenantId, scan.accountId, scan.scanId),
        entity: ENTITY.scan,
        ...scan,
      },
      `Scan ${scan.scanId} already exists`,
    );
  }

  get(tenantId: string, scanId: string): Promise<ScanExecution | null> {
    return this.table.get<ScanExecution>(keys.scan(tenantId, scanId));
  }

  list(tenantId: string, filter: ScanListFilter): Promise<Page<ScanExecution>> {
    const statusFilter = filter.status
      ? {
          expression: '#status = :status',
          names: { '#status': 'status' },
          values: { ':status': filter.status },
        }
      : undefined;
    const base = filter.accountId
      ? { pk: keys.scanByAccountPk(tenantId, filter.accountId), index: 'GSI1' as const }
      : { pk: keys.scan(tenantId, '').PK, skPrefix: keys.scanPrefix };
    return this.table.queryFilledPage<ScanExecution>({
      ...base,
      ...(statusFilter ? { filter: statusFilter } : {}),
      limit: filter.limit,
      ...(filter.cursor ? { cursor: filter.cursor } : {}),
      cursorScope: tenantPrefix(tenantId),
      ascending: false,
    });
  }

  async listRecent(tenantId: string, limit: number): Promise<ScanExecution[]> {
    const page = await this.table.queryPage<ScanExecution>({
      pk: keys.scan(tenantId, '').PK,
      skPrefix: keys.scanPrefix,
      limit,
      ascending: false,
    });
    return page.items;
  }

  update(
    tenantId: string,
    scanId: string,
    changes: Partial<ScanExecution>,
    options: { onlyIfStatusIn?: ScanStatus[] } = {},
  ): Promise<ScanExecution> {
    const statuses = options.onlyIfStatusIn;
    return this.table.patch<ScanExecution>(keys.scan(tenantId, scanId), changes, {
      ...(statuses?.length
        ? {
            extraCondition: {
              expression: `#st IN (${statuses.map((_, i) => `:st${i}`).join(', ')})`,
              names: { '#st': 'status' },
              values: Object.fromEntries(statuses.map((s, i) => [`:st${i}`, s])),
            },
          }
        : {}),
    });
  }

  async setStep(tenantId: string, scanId: string, step: ScanStepName, state: ScanStepState): Promise<void> {
    await this.table.update({
      key: keys.scan(tenantId, scanId),
      updateExpression: 'SET #steps.#step = :state, updatedAt = :now',
      names: { '#steps': 'steps', '#step': step },
      values: { ':state': state, ':now': new Date().toISOString() },
      condition: 'attribute_exists(PK)',
    });
  }

  async appendErrors(tenantId: string, scanId: string, errors: ScanError[]): Promise<void> {
    if (errors.length === 0) return;
    await this.table.update({
      key: keys.scan(tenantId, scanId),
      updateExpression:
        'SET #errors = list_append(if_not_exists(#errors, :empty), :errors), updatedAt = :now',
      names: { '#errors': 'errors' },
      values: { ':errors': errors.slice(0, 100), ':empty': [], ':now': new Date().toISOString() },
      condition: 'attribute_exists(PK)',
    });
  }

  async setDiscovery(tenantId: string, scanId: string, discovery: DiscoveryTypeResult[]): Promise<void> {
    await this.table.update({
      key: keys.scan(tenantId, scanId),
      updateExpression: 'SET discovery = :d, updatedAt = :now',
      values: { ':d': discovery, ':now': new Date().toISOString() },
      condition: 'attribute_exists(PK)',
    });
  }

  async acquireLock(
    tenantId: string,
    accountId: string,
    scanId: string,
    ttlSeconds: number,
    now: Date,
  ): Promise<boolean> {
    const nowEpoch = epochSeconds(now);
    try {
      await this.table.put(
        {
          ...keys.scanLock(tenantId, accountId),
          entity: ENTITY.scanLock,
          scanId,
          acquiredAt: now.toISOString(),
          expiresAt: nowEpoch + ttlSeconds,
        },
        {
          expression: 'attribute_not_exists(PK) OR expiresAt < :now OR scanId = :scanId',
          values: { ':now': nowEpoch, ':scanId': scanId },
        },
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  async getLock(tenantId: string, accountId: string, now: Date): Promise<ScanLock | null> {
    const raw = await this.table.getRaw(keys.scanLock(tenantId, accountId));
    if (!raw || (raw.expiresAt as number) < epochSeconds(now)) return null;
    return { scanId: raw.scanId, acquiredAt: raw.acquiredAt, expiresAt: raw.expiresAt };
  }

  async releaseLock(tenantId: string, accountId: string, scanId: string): Promise<void> {
    await this.table.delete(keys.scanLock(tenantId, accountId), {
      expression: 'scanId = :scanId',
      values: { ':scanId': scanId },
    });
  }

  async claimIdempotencyKey(
    tenantId: string,
    key: string,
    scanId: string,
    ttlSeconds: number,
    now: Date,
  ): Promise<string | null> {
    const nowEpoch = epochSeconds(now);
    try {
      await this.table.put(
        {
          ...keys.idempotency(tenantId, key),
          entity: ENTITY.idempotency,
          scanId,
          expiresAt: nowEpoch + ttlSeconds,
        },
        { expression: 'attribute_not_exists(PK) OR expiresAt < :now', values: { ':now': nowEpoch } },
      );
      return null;
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
      const existing = await this.table.getRaw(keys.idempotency(tenantId, key));
      return (existing?.scanId as string | undefined) ?? null;
    }
  }

  async releaseIdempotencyKey(tenantId: string, key: string, scanId: string): Promise<void> {
    await this.table.delete(keys.idempotency(tenantId, key), {
      expression: 'scanId = :scanId',
      values: { ':scanId': scanId },
    });
  }
}
