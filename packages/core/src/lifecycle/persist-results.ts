import type {
  CloudResource,
  DetectionResult,
  DiscoveryTypeResult,
  FindingRecord,
  NormalizedResource,
  PersistOutcome,
  PricedRecommendationDraft,
  RecommendationRecord,
} from '@cloudsentry/shared-types';
import type { Repositories } from '@cloudsentry/database';
import {
  PreconditionFailedError,
  findingIdFor,
  mapWithConcurrency,
  roundMoney,
  type Logger,
} from '@cloudsentry/utilities';
import {
  mergeFinding,
  mergeRecommendation,
  resolveFinding,
  resolveRecommendation,
  type LifecycleContext,
} from './finding-lifecycle';

export interface PersistInput {
  tenantId: string;
  accountId: string;
  scanId: string;
  now: string;
  normalized: NormalizedResource[];
  discovery: DiscoveryTypeResult[];
  detection: DetectionResult;
  priced: PricedRecommendationDraft[];
}

const ACTIVE_FINDING_STATUSES = new Set(['OPEN', 'ACKNOWLEDGED']);
const OPEN_RECOMMENDATION_STATUSES = new Set(['OPEN', 'UNDER_REVIEW', 'ACCEPTED']);

/**
 * Writes one scan's results. Idempotent per scanId: re-running after a partial failure skips records
 * already written by this scan (lastScanId) and never double-counts occurrences.
 * Resources/findings are only marked gone where discovery for that (type, region) fully succeeded.
 */
export async function persistScanResults(
  repos: Repositories,
  input: PersistInput,
  logger: Logger,
): Promise<PersistOutcome> {
  const ctx: LifecycleContext = { tenantId: input.tenantId, scanId: input.scanId, now: input.now };
  const succeeded = new Set<string>();
  for (const d of input.discovery)
    for (const r of d.regionsSucceeded) succeeded.add(`${d.resourceType}|${r}`);

  // ---- Findings ----
  const existingFindings = new Map(
    (await repos.findings.listAll(input.tenantId, { accountId: input.accountId })).map((f) => [
      f.findingId,
      f,
    ]),
  );
  const finalFindings = new Map(existingFindings);
  const outcome: PersistOutcome = {
    resourcesUpserted: 0,
    resourcesMarkedNotFound: 0,
    findingsDetected: input.priced.length,
    newFindingIds: [],
    reopenedFindingIds: [],
    resolvedFindingIds: [],
    newRecommendationIds: [],
    reopenedRecommendationIds: [],
    openRecommendations: 0,
    potentialMonthlySavings: 0,
    criticalFindings: 0,
  };

  await mapWithConcurrency(input.priced, 10, async (draft) => {
    const record = await writeWithRetry(
      () => repos.findings.get(input.tenantId, draft.findingId),
      (current) => mergeFinding(current, draft, ctx),
      (next, expected) => repos.findings.putVersioned(next, expected),
    );
    finalFindings.set(record.record.findingId, record.record);
    if (record.transition === 'NEW') outcome.newFindingIds.push(record.record.findingId);
    if (record.transition === 'REOPENED') outcome.reopenedFindingIds.push(record.record.findingId);
  });

  // ---- Resources ----
  const existingResources = new Map(
    (await repos.resources.listByAccount(input.tenantId, input.accountId)).map((r) => [r.resourceKey, r]),
  );
  const seen = new Set(input.normalized.map((r) => r.resourceKey));
  const notFoundKeys = new Set<string>();
  for (const r of existingResources.values()) {
    if (
      r.lifecycleStatus === 'ACTIVE' &&
      !seen.has(r.resourceKey) &&
      succeeded.has(`${r.resourceType}|${r.region}`)
    ) {
      notFoundKeys.add(r.resourceKey);
    }
  }

  // ---- Resolve findings no longer detected ----
  const detectedIds = new Set(input.priced.map((p) => p.findingId));
  const toResolve: { finding: FindingRecord; reason: 'NOT_DETECTED' | 'RESOURCE_NOT_FOUND' }[] = [];
  for (const ev of input.detection.evaluations) {
    if (ev.outcome !== 'NOT_DETECTED') continue;
    const id = findingIdFor(ev.accountId, ev.region, ev.ruleId, ev.resourceId);
    const f = existingFindings.get(id);
    if (f && !detectedIds.has(id)) toResolve.push({ finding: f, reason: 'NOT_DETECTED' });
  }
  for (const f of existingFindings.values()) {
    if (notFoundKeys.has(f.resourceKey) && !detectedIds.has(f.findingId))
      toResolve.push({ finding: f, reason: 'RESOURCE_NOT_FOUND' });
  }
  const resolvedFindingIds = new Set<string>();
  await mapWithConcurrency(toResolve, 10, async ({ finding, reason }) => {
    if (resolvedFindingIds.has(finding.findingId)) return;
    resolvedFindingIds.add(finding.findingId);
    const result = await writeWithRetry(
      () => repos.findings.get(input.tenantId, finding.findingId),
      (current) => {
        const next = current ? resolveFinding(current, reason, ctx) : null;
        return next ? { record: next, transition: 'UPDATED' as const } : null;
      },
      (next, expected) => repos.findings.putVersioned(next, expected),
    );
    if (result) {
      finalFindings.set(result.record.findingId, result.record);
      outcome.resolvedFindingIds.push(result.record.findingId);
    }
  });

  // ---- Recommendations ----
  const finalRecommendations = new Map<string, RecommendationRecord>();
  await mapWithConcurrency(input.priced, 10, async (draft) => {
    const result = await writeWithRetry(
      () => repos.recommendations.get(input.tenantId, draft.recommendationId),
      (current) => mergeRecommendation(current, draft, ctx),
      (next, expected) => repos.recommendations.putVersioned(next, expected),
    );
    finalRecommendations.set(result.record.recommendationId, result.record);
    if (result.transition === 'NEW') outcome.newRecommendationIds.push(result.record.recommendationId);
    if (result.transition === 'REOPENED')
      outcome.reopenedRecommendationIds.push(result.record.recommendationId);
  });
  const existingRecs = await repos.recommendations.listAll(input.tenantId, { accountId: input.accountId });
  await mapWithConcurrency(
    existingRecs.filter((r) => resolvedFindingIds.has(r.findingId)),
    10,
    async (rec) => {
      const result = await writeWithRetry(
        () => repos.recommendations.get(input.tenantId, rec.recommendationId),
        (current) => {
          const next = current ? resolveRecommendation(current, ctx) : null;
          return next ? { record: next, transition: 'UPDATED' as const } : null;
        },
        (next, expected) => repos.recommendations.putVersioned(next, expected),
      );
      if (result) finalRecommendations.set(result.record.recommendationId, result.record);
    },
  );
  for (const r of existingRecs)
    if (!finalRecommendations.has(r.recommendationId)) finalRecommendations.set(r.recommendationId, r);

  // ---- Resource records with lifecycle and active finding counts ----
  const activeCounts = new Map<string, number>();
  for (const f of finalFindings.values()) {
    if (ACTIVE_FINDING_STATUSES.has(f.status))
      activeCounts.set(f.resourceKey, (activeCounts.get(f.resourceKey) ?? 0) + 1);
  }
  const resourceWrites: CloudResource[] = input.normalized.map((r) => {
    const prev = existingResources.get(r.resourceKey);
    return {
      ...r,
      tenantId: input.tenantId,
      lifecycleStatus: 'ACTIVE',
      firstSeenAt: prev?.firstSeenAt ?? input.now,
      lastSeenAt: input.now,
      lastSeenScanId: input.scanId,
      activeFindingCount: activeCounts.get(r.resourceKey) ?? 0,
      updatedAt: input.now,
      version: (prev?.version ?? 0) + 1,
    } as CloudResource;
  });
  for (const key of notFoundKeys) {
    const prev = existingResources.get(key);
    if (!prev) continue;
    resourceWrites.push({
      ...prev,
      lifecycleStatus: 'NOT_FOUND',
      activeFindingCount: activeCounts.get(key) ?? 0,
      updatedAt: input.now,
      version: prev.version + 1,
    });
  }
  await repos.resources.putMany(resourceWrites);
  outcome.resourcesUpserted = input.normalized.length;
  outcome.resourcesMarkedNotFound = notFoundKeys.size;

  for (const r of finalRecommendations.values()) {
    if (OPEN_RECOMMENDATION_STATUSES.has(r.status)) {
      outcome.openRecommendations++;
      outcome.potentialMonthlySavings += r.estimatedMonthlySavings ?? 0;
    }
  }
  outcome.potentialMonthlySavings = roundMoney(outcome.potentialMonthlySavings);
  outcome.criticalFindings = [...finalFindings.values()].filter(
    (f) => f.severity === 'CRITICAL' && ACTIVE_FINDING_STATUSES.has(f.status),
  ).length;

  logger.info('Scan results persisted', {
    scanId: input.scanId,
    resources: outcome.resourcesUpserted,
    notFound: outcome.resourcesMarkedNotFound,
    newFindings: outcome.newFindingIds.length,
    reopened: outcome.reopenedFindingIds.length,
    resolved: outcome.resolvedFindingIds.length,
  });
  return outcome;
}

/** Read-merge-write with optimistic locking; retries when a concurrent user update changed the record. */
async function writeWithRetry<T extends { version: number }, R extends { record: T; transition: string }>(
  read: () => Promise<T | null>,
  merge: (current: T | null) => R | null,
  write: (next: T, expectedVersion: number | null) => Promise<void>,
  attempts = 4,
): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    const current = await read();
    const merged = merge(current);
    if (!merged) return null as unknown as R;
    if (merged.transition === 'ALREADY_PROCESSED') return merged;
    try {
      await write(merged.record, current ? current.version : null);
      return merged;
    } catch (error) {
      if (!(error instanceof PreconditionFailedError) || attempt >= attempts - 1) throw error;
    }
  }
}
