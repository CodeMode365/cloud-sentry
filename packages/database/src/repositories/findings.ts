import type {
  FindingCategory,
  FindingRecord,
  FindingStatus,
  RecommendationRecord,
  RecommendationStatus,
  ResourceType,
  Severity,
} from '@cloudsentry/shared-types';
import { FilterBuilder } from '../filters';
import { ENTITY, keys, tenantPrefix } from '../keys';
import type { Item, Page, Table } from '../table';

export interface FindingListFilter {
  accountId?: string;
  resourceTypes?: ResourceType[];
  severities?: Severity[];
  categories?: FindingCategory[];
  statuses?: FindingStatus[];
  resourceKey?: string;
}

export interface FindingRepository {
  get(tenantId: string, findingId: string): Promise<FindingRecord | null>;
  getMany(tenantId: string, findingIds: string[]): Promise<FindingRecord[]>;
  list(
    tenantId: string,
    filter: FindingListFilter,
    page: { limit: number; cursor?: string },
  ): Promise<Page<FindingRecord>>;
  listAll(tenantId: string, filter: FindingListFilter, max?: number): Promise<FindingRecord[]>;
  /** Optimistically-locked write: expectedVersion null means the record must not exist. */
  putVersioned(record: FindingRecord, expectedVersion: number | null): Promise<void>;
  deleteByAccount(tenantId: string, accountId: string): Promise<number>;
}

export interface RecommendationListFilter {
  accountId?: string;
  resourceTypes?: ResourceType[];
  statuses?: RecommendationStatus[];
  minMonthlySavings?: number;
  resourceKey?: string;
}

export interface RecommendationRepository {
  get(tenantId: string, recommendationId: string): Promise<RecommendationRecord | null>;
  getMany(tenantId: string, recommendationIds: string[]): Promise<RecommendationRecord[]>;
  list(
    tenantId: string,
    filter: RecommendationListFilter,
    page: { limit: number; cursor?: string },
  ): Promise<Page<RecommendationRecord>>;
  listAll(tenantId: string, filter: RecommendationListFilter, max?: number): Promise<RecommendationRecord[]>;
  putVersioned(record: RecommendationRecord, expectedVersion: number | null): Promise<void>;
  deleteByAccount(tenantId: string, accountId: string): Promise<number>;
}

export class DynamoFindingRepository implements FindingRepository {
  constructor(private readonly table: Table) {}

  private toItem(r: FindingRecord): Item & { version: number } {
    return {
      PK: keys.findingsPk(r.tenantId),
      SK: keys.findingSk(r.findingId),
      GSI1PK: keys.byResourcePk(r.tenantId, r.resourceKey),
      GSI1SK: keys.findingSk(r.findingId),
      entity: ENTITY.finding,
      ...r,
    };
  }

  get(tenantId: string, findingId: string): Promise<FindingRecord | null> {
    return this.table.get<FindingRecord>({ PK: keys.findingsPk(tenantId), SK: keys.findingSk(findingId) });
  }

  getMany(tenantId: string, findingIds: string[]): Promise<FindingRecord[]> {
    return this.table.batchGet<FindingRecord>(
      findingIds.map((id) => ({ PK: keys.findingsPk(tenantId), SK: keys.findingSk(id) })),
    );
  }

  private shape(tenantId: string, filter: FindingListFilter) {
    const f = new FilterBuilder()
      .eq('accountId', filter.accountId)
      .in('resourceType', filter.resourceTypes)
      .in('severity', filter.severities)
      .in('category', filter.categories)
      .in('status', filter.statuses);
    const built = f.build();
    const base = filter.resourceKey
      ? { pk: keys.byResourcePk(tenantId, filter.resourceKey), index: 'GSI1' as const, skPrefix: 'FINDING#' }
      : { pk: keys.findingsPk(tenantId), skPrefix: 'FINDING#' };
    return { ...base, ...(built ? { filter: built } : {}) };
  }

  list(
    tenantId: string,
    filter: FindingListFilter,
    page: { limit: number; cursor?: string },
  ): Promise<Page<FindingRecord>> {
    return this.table.queryFilledPage<FindingRecord>({
      ...this.shape(tenantId, filter),
      limit: page.limit,
      ...(page.cursor ? { cursor: page.cursor } : {}),
      cursorScope: tenantPrefix(tenantId),
    });
  }

  listAll(tenantId: string, filter: FindingListFilter, max = 20_000): Promise<FindingRecord[]> {
    return this.table.queryAll<FindingRecord>(this.shape(tenantId, filter), max);
  }

  putVersioned(record: FindingRecord, expectedVersion: number | null): Promise<void> {
    return this.table.putVersioned(this.toItem(record), expectedVersion);
  }

  async deleteByAccount(tenantId: string, accountId: string): Promise<number> {
    const all = await this.listAll(tenantId, { accountId });
    await this.table.batchWrite(
      [],
      all.map((r) => ({ PK: keys.findingsPk(tenantId), SK: keys.findingSk(r.findingId) })),
    );
    return all.length;
  }
}

export class DynamoRecommendationRepository implements RecommendationRepository {
  constructor(private readonly table: Table) {}

  private toItem(r: RecommendationRecord): Item & { version: number } {
    return {
      PK: keys.recommendationsPk(r.tenantId),
      SK: keys.recommendationSk(r.recommendationId),
      GSI1PK: keys.byResourcePk(r.tenantId, r.resourceKey),
      GSI1SK: keys.recommendationSk(r.recommendationId),
      entity: ENTITY.recommendation,
      ...r,
    };
  }

  get(tenantId: string, recommendationId: string): Promise<RecommendationRecord | null> {
    return this.table.get<RecommendationRecord>({
      PK: keys.recommendationsPk(tenantId),
      SK: keys.recommendationSk(recommendationId),
    });
  }

  getMany(tenantId: string, ids: string[]): Promise<RecommendationRecord[]> {
    return this.table.batchGet<RecommendationRecord>(
      ids.map((id) => ({ PK: keys.recommendationsPk(tenantId), SK: keys.recommendationSk(id) })),
    );
  }

  private shape(tenantId: string, filter: RecommendationListFilter) {
    const f = new FilterBuilder()
      .eq('accountId', filter.accountId)
      .in('resourceType', filter.resourceTypes)
      .in('status', filter.statuses)
      .gte('estimatedMonthlySavings', filter.minMonthlySavings);
    const built = f.build();
    const base = filter.resourceKey
      ? { pk: keys.byResourcePk(tenantId, filter.resourceKey), index: 'GSI1' as const, skPrefix: 'REC#' }
      : { pk: keys.recommendationsPk(tenantId), skPrefix: 'REC#' };
    return { ...base, ...(built ? { filter: built } : {}) };
  }

  list(
    tenantId: string,
    filter: RecommendationListFilter,
    page: { limit: number; cursor?: string },
  ): Promise<Page<RecommendationRecord>> {
    return this.table.queryFilledPage<RecommendationRecord>({
      ...this.shape(tenantId, filter),
      limit: page.limit,
      ...(page.cursor ? { cursor: page.cursor } : {}),
      cursorScope: tenantPrefix(tenantId),
    });
  }

  listAll(tenantId: string, filter: RecommendationListFilter, max = 20_000): Promise<RecommendationRecord[]> {
    return this.table.queryAll<RecommendationRecord>(this.shape(tenantId, filter), max);
  }

  putVersioned(record: RecommendationRecord, expectedVersion: number | null): Promise<void> {
    return this.table.putVersioned(this.toItem(record), expectedVersion);
  }

  async deleteByAccount(tenantId: string, accountId: string): Promise<number> {
    const all = await this.listAll(tenantId, { accountId });
    await this.table.batchWrite(
      [],
      all.map((r) => ({
        PK: keys.recommendationsPk(tenantId),
        SK: keys.recommendationSk(r.recommendationId),
      })),
    );
    return all.length;
  }
}
