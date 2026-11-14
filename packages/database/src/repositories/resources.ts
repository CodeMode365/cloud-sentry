import type { CloudResource, ResourceType } from '@cloudsentry/shared-types';
import { parseResourceKey } from '@cloudsentry/utilities';
import { FilterBuilder } from '../filters';
import { ENTITY, keys, tenantPrefix } from '../keys';
import type { Item, Page, Table } from '../table';

export interface ResourceListFilter {
  accountId?: string;
  resourceTypes?: ResourceType[];
  regions?: string[];
  state?: string;
  search?: string;
  hasFindings?: boolean;
  includeNotFound?: boolean;
}

export interface ResourceRepository {
  get(tenantId: string, resourceKey: string): Promise<CloudResource | null>;
  getMany(tenantId: string, resourceKeys: string[]): Promise<CloudResource[]>;
  list(
    tenantId: string,
    filter: ResourceListFilter,
    page: { limit: number; cursor?: string },
  ): Promise<Page<CloudResource>>;
  listAll(tenantId: string, filter: ResourceListFilter, max?: number): Promise<CloudResource[]>;
  listByAccount(tenantId: string, accountId: string): Promise<CloudResource[]>;
  putMany(resources: CloudResource[]): Promise<void>;
  deleteByAccount(tenantId: string, accountId: string): Promise<number>;
}

function searchText(r: CloudResource): string {
  return [
    r.resourceId,
    r.name ?? '',
    r.region,
    r.resourceType,
    ...Object.entries(r.tags).map(([k, v]) => `${k}=${v}`),
  ]
    .join(' ')
    .toLowerCase()
    .slice(0, 2000);
}

export function resourceSkFromKey(resourceKey: string): string | null {
  const parsed = parseResourceKey(resourceKey);
  if (!parsed) return null;
  return keys.resourceSk(parsed.accountId, parsed.region, parsed.resourceType, parsed.resourceId);
}

export class DynamoResourceRepository implements ResourceRepository {
  constructor(private readonly table: Table) {}

  private toItem(r: CloudResource): Item {
    return {
      PK: keys.resourcesPk(r.tenantId),
      SK: keys.resourceSk(r.accountId, r.region, r.resourceType, r.resourceId),
      ...keys.resourceGsi(r.tenantId, r.accountId, r.region, r.resourceType, r.resourceId),
      entity: ENTITY.resource,
      searchText: searchText(r),
      ...r,
    };
  }

  async get(tenantId: string, resourceKey: string): Promise<CloudResource | null> {
    const sk = resourceSkFromKey(resourceKey);
    if (!sk) return null;
    return this.table.get<CloudResource>({ PK: keys.resourcesPk(tenantId), SK: sk });
  }

  async getMany(tenantId: string, resourceKeys: string[]): Promise<CloudResource[]> {
    const keyList = resourceKeys
      .map((k) => resourceSkFromKey(k))
      .filter((sk): sk is string => sk !== null)
      .map((SK) => ({ PK: keys.resourcesPk(tenantId), SK }));
    return this.table.batchGet<CloudResource>(keyList);
  }

  private queryShape(tenantId: string, filter: ResourceListFilter) {
    const f = new FilterBuilder();
    const singleType = filter.resourceTypes?.length === 1 ? filter.resourceTypes[0] : undefined;
    let base: { pk: string; index?: 'GSI1'; skPrefix?: string };
    if (singleType) {
      base = {
        pk: keys.resourceTypePk(tenantId, singleType),
        index: 'GSI1',
        ...(filter.accountId ? { skPrefix: `RES#${filter.accountId}#` } : {}),
      };
    } else {
      f.in('resourceType', filter.resourceTypes);
      base = {
        pk: keys.resourcesPk(tenantId),
        skPrefix:
          filter.accountId && filter.regions?.length === 1
            ? `RES#${filter.accountId}#${filter.regions[0]}#`
            : filter.accountId
              ? `RES#${filter.accountId}#`
              : 'RES#',
      };
    }
    f.in('region', filter.regions);
    f.eq('state', filter.state);
    f.contains('searchText', filter.search?.toLowerCase());
    if (filter.hasFindings === true) f.gt('activeFindingCount', 0);
    if (filter.hasFindings === false) f.eq('activeFindingCount', 0);
    if (!filter.includeNotFound) f.eq('lifecycleStatus', 'ACTIVE');
    const built = f.build();
    return { ...base, ...(built ? { filter: built } : {}) };
  }

  list(
    tenantId: string,
    filter: ResourceListFilter,
    page: { limit: number; cursor?: string },
  ): Promise<Page<CloudResource>> {
    return this.table.queryFilledPage<CloudResource>({
      ...this.queryShape(tenantId, filter),
      limit: page.limit,
      ...(page.cursor ? { cursor: page.cursor } : {}),
      cursorScope: tenantPrefix(tenantId),
    });
  }

  listAll(tenantId: string, filter: ResourceListFilter, max = 5000): Promise<CloudResource[]> {
    return this.table.queryAll<CloudResource>(this.queryShape(tenantId, filter), max);
  }

  listByAccount(tenantId: string, accountId: string): Promise<CloudResource[]> {
    return this.table.queryAll<CloudResource>(
      { pk: keys.resourcesPk(tenantId), skPrefix: `RES#${accountId}#` },
      50_000,
    );
  }

  async putMany(resources: CloudResource[]): Promise<void> {
    await this.table.batchWrite(resources.map((r) => this.toItem(r)));
  }

  async deleteByAccount(tenantId: string, accountId: string): Promise<number> {
    const existing = await this.listByAccount(tenantId, accountId);
    await this.table.batchWrite(
      [],
      existing.map((r) => ({
        PK: keys.resourcesPk(tenantId),
        SK: keys.resourceSk(r.accountId, r.region, r.resourceType, r.resourceId),
      })),
    );
    return existing.length;
  }
}
