import type {
  FindingRecord,
  PricedRecommendationDraft,
  RecommendationRecord,
  RecommendationStatus,
  StatusChange,
} from '@cloudsentry/shared-types';

/**
 * Pure lifecycle rules for findings and recommendations. Deduplication comes from deterministic IDs;
 * these functions decide how a detection in scan N changes an existing record from scan N-1.
 */

export type MergeTransition = 'NEW' | 'REOPENED' | 'UPDATED' | 'ALREADY_PROCESSED';

export interface LifecycleContext {
  tenantId: string;
  scanId: string;
  now: string;
}

const HISTORY_LIMIT = 20;

export function mergeFinding(
  existing: FindingRecord | null,
  draft: PricedRecommendationDraft,
  ctx: LifecycleContext,
): { record: FindingRecord; transition: MergeTransition } {
  if (existing && existing.lastScanId === ctx.scanId)
    return { record: existing, transition: 'ALREADY_PROCESSED' };
  const issue = draft.issue;
  const priced = draft.savings.status === 'ESTIMATED';
  const content = {
    accountId: issue.accountId,
    region: issue.region,
    resourceType: issue.resourceType,
    resourceKey: issue.resourceKey,
    resourceId: issue.resourceId,
    resourceName: issue.resourceName,
    ruleId: issue.ruleId,
    ruleName: issue.ruleName,
    ruleVersion: issue.ruleVersion,
    category: issue.category,
    title: issue.title,
    description: issue.description,
    severity: draft.severity,
    confidence: issue.confidence,
    evidence: issue.evidence,
    thresholds: issue.thresholds,
    estimatedMonthlySavings: priced ? draft.savings.monthly : null,
    savingsEstimateType: priced ? draft.savings.estimateType : null,
    currency: 'USD' as const,
    lastDetectedAt: ctx.now,
    lastEvaluatedAt: ctx.now,
    lastScanId: ctx.scanId,
    updatedAt: ctx.now,
  };
  if (!existing) {
    return {
      transition: 'NEW',
      record: {
        findingId: issue.findingId,
        tenantId: ctx.tenantId,
        ...content,
        status: 'OPEN',
        firstDetectedAt: ctx.now,
        occurrenceCount: 1,
        reopenCount: 0,
        resolvedAt: null,
        resolutionReason: null,
        statusNote: null,
        statusUpdatedBy: null,
        statusUpdatedAt: null,
        createdAt: ctx.now,
        version: 1,
      },
    };
  }
  const reopened = existing.status === 'RESOLVED';
  return {
    transition: reopened ? 'REOPENED' : 'UPDATED',
    record: {
      ...existing,
      ...content,
      status: reopened ? 'OPEN' : existing.status,
      occurrenceCount: existing.occurrenceCount + 1,
      reopenCount: existing.reopenCount + (reopened ? 1 : 0),
      resolvedAt: reopened ? null : existing.resolvedAt,
      resolutionReason: reopened ? null : existing.resolutionReason,
      version: existing.version + 1,
    },
  };
}

export function resolveFinding(
  existing: FindingRecord,
  reason: 'NOT_DETECTED' | 'RESOURCE_NOT_FOUND',
  ctx: LifecycleContext,
): FindingRecord | null {
  if (existing.status === 'RESOLVED' || existing.lastScanId === ctx.scanId) return null;
  return {
    ...existing,
    status: 'RESOLVED',
    resolvedAt: ctx.now,
    resolutionReason: reason,
    lastEvaluatedAt: ctx.now,
    lastScanId: ctx.scanId,
    updatedAt: ctx.now,
    version: existing.version + 1,
  };
}

function pushHistory(
  history: StatusChange<RecommendationStatus>[],
  entry: StatusChange<RecommendationStatus>,
): StatusChange<RecommendationStatus>[] {
  return [entry, ...history].slice(0, HISTORY_LIMIT);
}

export function mergeRecommendation(
  existing: RecommendationRecord | null,
  draft: PricedRecommendationDraft,
  ctx: LifecycleContext,
): { record: RecommendationRecord; transition: MergeTransition } {
  if (existing && existing.lastScanId === ctx.scanId)
    return { record: existing, transition: 'ALREADY_PROCESSED' };
  const issue = draft.issue;
  const content = {
    findingId: draft.findingId,
    accountId: issue.accountId,
    region: issue.region,
    resourceType: issue.resourceType,
    resourceKey: issue.resourceKey,
    resourceId: issue.resourceId,
    resourceName: issue.resourceName,
    ruleId: issue.ruleId,
    title: draft.title,
    description: draft.description,
    evidence: issue.evidence,
    suggestedAction: draft.suggestedAction,
    savings: draft.savings,
    estimatedMonthlySavings: draft.savings.monthly,
    estimatedAnnualSavings: draft.savings.annual,
    currency: 'USD' as const,
    confidence: draft.confidence,
    riskLevel: draft.riskLevel,
    severity: draft.severity,
    lastScanId: ctx.scanId,
    updatedAt: ctx.now,
  };
  if (!existing) {
    return {
      transition: 'NEW',
      record: {
        recommendationId: draft.recommendationId,
        tenantId: ctx.tenantId,
        ...content,
        status: 'OPEN',
        statusNote: null,
        statusHistory: [{ status: 'OPEN', at: ctx.now, by: 'system', note: 'Detected by scan' }],
        realizedMonthlySavingsEstimate: null,
        resolvedAt: null,
        createdAt: ctx.now,
        version: 1,
      },
    };
  }
  const reopened = existing.status === 'RESOLVED';
  return {
    transition: reopened ? 'REOPENED' : 'UPDATED',
    record: {
      ...existing,
      ...content,
      status: reopened ? 'OPEN' : existing.status,
      statusHistory: reopened
        ? pushHistory(existing.statusHistory, {
            status: 'OPEN',
            at: ctx.now,
            by: 'system',
            note: 'Issue detected again',
          })
        : existing.statusHistory,
      resolvedAt: reopened ? null : existing.resolvedAt,
      realizedMonthlySavingsEstimate: reopened ? null : existing.realizedMonthlySavingsEstimate,
      version: existing.version + 1,
    },
  };
}

/**
 * When the underlying finding is resolved: OPEN/UNDER_REVIEW/ACCEPTED become RESOLVED. ACCEPTED records
 * keep their estimate as `realizedMonthlySavingsEstimate`. DISMISSED recommendations stay DISMISSED.
 */
export function resolveRecommendation(
  existing: RecommendationRecord,
  ctx: LifecycleContext,
): RecommendationRecord | null {
  if (existing.status === 'RESOLVED' || existing.status === 'DISMISSED' || existing.lastScanId === ctx.scanId)
    return null;
  return {
    ...existing,
    status: 'RESOLVED',
    realizedMonthlySavingsEstimate: existing.status === 'ACCEPTED' ? existing.estimatedMonthlySavings : null,
    statusHistory: pushHistory(existing.statusHistory, {
      status: 'RESOLVED',
      at: ctx.now,
      by: 'system',
      note: 'Issue no longer detected',
    }),
    resolvedAt: ctx.now,
    lastScanId: ctx.scanId,
    updatedAt: ctx.now,
    version: existing.version + 1,
  };
}

export function applyUserStatus(
  existing: RecommendationRecord,
  status: RecommendationStatus,
  by: string,
  note: string | null,
  now: string,
): RecommendationRecord {
  return {
    ...existing,
    status,
    statusNote: note,
    statusHistory: pushHistory(existing.statusHistory, { status, at: now, by, note }),
    updatedAt: now,
    version: existing.version + 1,
  };
}
