import type {
  AuthContext,
  CloudResource,
  FindingRecord,
  RecommendationRecord,
  ResourceDetailResponse,
} from '@cloudsentry/shared-types';
import type {
  ListFindingsQuery,
  ListRecommendationsQuery,
  ListResourcesQuery,
  UpdateFindingRequest,
  UpdateRecommendationRequest,
} from '@cloudsentry/validators';
import type { Page, ResourceListFilter } from '@cloudsentry/database';
import { NotFoundError, PreconditionFailedError, ValidationError } from '@cloudsentry/utilities';
import { requireRole } from '../auth/authorization';
import type { ServiceContext } from '../context';
import { applyUserStatus } from '../lifecycle/finding-lifecycle';

const SORT_CAP = 5000;

function encodeOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}
function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof v.o === 'number' && Number.isInteger(v.o) && v.o >= 0) return v.o;
  } catch {
    /* fallthrough */
  }
  throw new ValidationError('Invalid pagination cursor');
}

export class InventoryService {
  constructor(private readonly ctx: ServiceContext) {}

  // ---------------- Resources ----------------
  async listResources(auth: AuthContext, q: ListResourcesQuery): Promise<Page<CloudResource>> {
    const filter: ResourceListFilter = {
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.resourceType ? { resourceTypes: q.resourceType } : {}),
      ...(q.region ? { regions: q.region } : {}),
      ...(q.state ? { state: q.state } : {}),
      ...(q.search ? { search: q.search } : {}),
      ...(q.hasFindings !== undefined ? { hasFindings: q.hasFindings } : {}),
      ...(q.includeNotFound !== undefined ? { includeNotFound: q.includeNotFound } : {}),
    };
    if (!q.sort) {
      return this.ctx.repos.resources.list(auth.tenantId, filter, {
        limit: q.limit,
        ...(q.cursor ? { cursor: q.cursor } : {}),
      });
    }
    // Sorted listing: DynamoDB cannot sort by arbitrary attributes, so load (capped) and sort in memory.
    const offset = decodeOffset(q.cursor);
    const all = await this.ctx.repos.resources.listAll(auth.tenantId, filter, SORT_CAP);
    const dir = q.order === 'asc' ? 1 : -1;
    const field = q.sort;
    all.sort((a, b) => {
      const av = (a[field as keyof CloudResource] ?? '') as string | number;
      const bv = (b[field as keyof CloudResource] ?? '') as string | number;
      return av < bv ? -dir : av > bv ? dir : a.resourceKey.localeCompare(b.resourceKey);
    });
    const items = all.slice(offset, offset + q.limit);
    return { items, nextCursor: offset + q.limit < all.length ? encodeOffset(offset + q.limit) : null };
  }

  async getResource(auth: AuthContext, resourceKey: string): Promise<ResourceDetailResponse> {
    const resource = await this.ctx.repos.resources.get(auth.tenantId, resourceKey);
    if (!resource) throw new NotFoundError('Resource', resourceKey);
    const [findings, recommendations] = await Promise.all([
      this.ctx.repos.findings.listAll(auth.tenantId, { resourceKey }),
      this.ctx.repos.recommendations.listAll(auth.tenantId, { resourceKey }),
    ]);
    return { resource, findings, recommendations };
  }

  // ---------------- Findings ----------------
  listFindings(auth: AuthContext, q: ListFindingsQuery): Promise<Page<FindingRecord>> {
    return this.ctx.repos.findings.list(
      auth.tenantId,
      {
        ...(q.accountId ? { accountId: q.accountId } : {}),
        ...(q.resourceType ? { resourceTypes: q.resourceType } : {}),
        ...(q.severity ? { severities: q.severity } : {}),
        ...(q.category ? { categories: q.category } : {}),
        ...(q.status ? { statuses: q.status } : {}),
        ...(q.resourceKey ? { resourceKey: q.resourceKey } : {}),
      },
      { limit: q.limit, ...(q.cursor ? { cursor: q.cursor } : {}) },
    );
  }

  async getFinding(auth: AuthContext, findingId: string): Promise<FindingRecord> {
    const f = await this.ctx.repos.findings.get(auth.tenantId, findingId);
    if (!f) throw new NotFoundError('Finding', findingId);
    return f;
  }

  async updateFinding(
    auth: AuthContext,
    findingId: string,
    input: UpdateFindingRequest,
  ): Promise<FindingRecord> {
    requireRole(auth, 'MEMBER');
    const existing = await this.getFinding(auth, findingId);
    if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version) {
      throw new PreconditionFailedError('The finding was modified by someone else; reload and retry', {
        currentVersion: existing.version,
      });
    }
    if (existing.status === 'RESOLVED') {
      throw new PreconditionFailedError('Resolved findings are managed by CloudSentry and cannot be changed');
    }
    const now = this.ctx.clock.now().toISOString();
    const next: FindingRecord = {
      ...existing,
      status: input.status,
      statusNote: input.note ?? null,
      statusUpdatedBy: auth.userId,
      statusUpdatedAt: now,
      updatedAt: now,
      version: existing.version + 1,
    };
    await this.ctx.repos.findings.putVersioned(next, existing.version);
    this.ctx.logger.audit('finding.status_changed', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      findingId,
      from: existing.status,
      to: input.status,
    });
    return next;
  }

  // ---------------- Recommendations ----------------
  async listRecommendations(
    auth: AuthContext,
    q: ListRecommendationsQuery,
  ): Promise<Page<RecommendationRecord>> {
    const filter = {
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.resourceType ? { resourceTypes: q.resourceType } : {}),
      ...(q.status ? { statuses: q.status } : {}),
      ...(q.minMonthlySavings !== undefined ? { minMonthlySavings: q.minMonthlySavings } : {}),
    };
    if (q.sort !== 'savings') {
      return this.ctx.repos.recommendations.list(auth.tenantId, filter, {
        limit: q.limit,
        ...(q.cursor ? { cursor: q.cursor } : {}),
      });
    }
    const offset = decodeOffset(q.cursor);
    const all = await this.ctx.repos.recommendations.listAll(auth.tenantId, filter, SORT_CAP);
    all.sort((a, b) => (b.estimatedMonthlySavings ?? -1) - (a.estimatedMonthlySavings ?? -1));
    return {
      items: all.slice(offset, offset + q.limit),
      nextCursor: offset + q.limit < all.length ? encodeOffset(offset + q.limit) : null,
    };
  }

  async getRecommendation(auth: AuthContext, id: string): Promise<RecommendationRecord> {
    const r = await this.ctx.repos.recommendations.get(auth.tenantId, id);
    if (!r) throw new NotFoundError('Recommendation', id);
    return r;
  }

  async updateRecommendation(
    auth: AuthContext,
    id: string,
    input: UpdateRecommendationRequest,
  ): Promise<RecommendationRecord> {
    requireRole(auth, 'MEMBER');
    const existing = await this.getRecommendation(auth, id);
    if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version) {
      throw new PreconditionFailedError('The recommendation was modified by someone else; reload and retry', {
        currentVersion: existing.version,
      });
    }
    if (existing.status === 'RESOLVED') {
      throw new PreconditionFailedError(
        'Resolved recommendations are managed by CloudSentry and cannot be changed',
      );
    }
    const next = applyUserStatus(
      existing,
      input.status,
      auth.userId,
      input.note ?? null,
      this.ctx.clock.now().toISOString(),
    );
    await this.ctx.repos.recommendations.putVersioned(next, existing.version);
    this.ctx.logger.audit('recommendation.status_changed', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      recommendationId: id,
      from: existing.status,
      to: input.status,
    });
    return next;
  }
}
