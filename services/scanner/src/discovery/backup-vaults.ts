import {
  paginateListBackupVaults,
  paginateListRecoveryPointsByBackupVault,
  type BackupClient,
  type BackupVaultListMember,
  type RecoveryPointByBackupVault,
} from '@aws-sdk/client-backup';
import {
  BACKUP_AGE_BUCKETS_DAYS,
  type BackupVaultAttributes,
  type BackupVaultResourceTypeSummary,
  type DiscoveredResourceOf,
} from '@cloudsentry/shared-types';
import { awsErrorName, errorMessage, mapSettledWithConcurrency, MS_PER_DAY } from '@cloudsentry/utilities';
import { loggerFor, SUB_CALL_CONCURRENCY, toIso, type DiscoveryContext } from './common';

/** Recovery points listed per vault; beyond this the vault is reported with `truncated: true`. */
export const RECOVERY_POINT_CAP = 5_000;
/** Window and cap for `resourcesWithMultiplePlans`. */
export const MULTIPLE_PLANS_WINDOW_DAYS = 35;
export const MULTIPLE_PLANS_CAP = 50;

type RecoveryPointSummary = Pick<
  BackupVaultAttributes,
  | 'recoveryPointCount'
  | 'totalBytes'
  | 'oldestRecoveryPointAt'
  | 'byResourceType'
  | 'resourcesWithMultiplePlans'
>;

/** Lower bound (days) of the non-cumulative age bucket an age falls into; negative ages count as 0. */
export function ageBucketFor(ageDays: number): number {
  let bucket: number = BACKUP_AGE_BUCKETS_DAYS[0];
  for (const minDays of BACKUP_AGE_BUCKETS_DAYS) if (ageDays >= minDays) bucket = minDays;
  return bucket;
}

/**
 * Summarizes listed recovery points by AWS Backup resource type and age (CreationDate vs `now`), and
 * finds resources backed up by two or more distinct plans (CreatedBy.BackupPlanId) within the last
 * MULTIPLE_PLANS_WINDOW_DAYS days. Points without a CreationDate fall into the youngest bucket.
 */
export function summarizeRecoveryPoints(
  points: readonly RecoveryPointByBackupVault[],
  now: Date,
): RecoveryPointSummary {
  const byType = new Map<string, BackupVaultResourceTypeSummary>();
  const plansByResource = new Map<string, { resourceType: string; planIds: Set<string> }>();
  const windowStart = now.getTime() - MULTIPLE_PLANS_WINDOW_DAYS * MS_PER_DAY;
  let totalBytes = 0;
  let oldest: number | null = null;

  for (const point of points) {
    const resourceType = point.ResourceType ?? 'unknown';
    const bytes = point.BackupSizeInBytes ?? 0;
    const created = point.CreationDate ? new Date(point.CreationDate).getTime() : Number.NaN;
    const hasCreated = !Number.isNaN(created);
    const ageDays = hasCreated ? (now.getTime() - created) / MS_PER_DAY : 0;
    totalBytes += bytes;
    if (hasCreated && (oldest === null || created < oldest)) oldest = created;

    let summary = byType.get(resourceType);
    if (!summary) {
      summary = {
        resourceType,
        count: 0,
        bytes: 0,
        byAge: BACKUP_AGE_BUCKETS_DAYS.map((minDays) => ({ minDays, count: 0, bytes: 0 })),
      };
      byType.set(resourceType, summary);
    }
    summary.count++;
    summary.bytes += bytes;
    const bucket = summary.byAge.find((b) => b.minDays === ageBucketFor(ageDays));
    if (bucket) {
      bucket.count++;
      bucket.bytes += bytes;
    }

    const planId = point.CreatedBy?.BackupPlanId;
    if (point.ResourceArn && planId && hasCreated && created >= windowStart) {
      const entry = plansByResource.get(point.ResourceArn) ?? { resourceType, planIds: new Set<string>() };
      entry.planIds.add(planId);
      plansByResource.set(point.ResourceArn, entry);
    }
  }

  const resourcesWithMultiplePlans = [...plansByResource.entries()]
    .filter(([, v]) => v.planIds.size >= 2)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MULTIPLE_PLANS_CAP)
    .map(([resourceArn, v]) => ({
      resourceArn,
      resourceType: v.resourceType,
      planIds: [...v.planIds].sort(),
    }));

  return {
    recoveryPointCount: points.length,
    totalBytes,
    oldestRecoveryPointAt: oldest === null ? null : new Date(oldest).toISOString(),
    byResourceType: [...byType.values()].sort((a, b) =>
      a.resourceType < b.resourceType ? -1 : a.resourceType > b.resourceType ? 1 : 0,
    ),
    resourcesWithMultiplePlans,
  };
}

/** Lists a vault's recovery points, stopping at `cap`; `truncated` is true when more points exist. */
export async function listRecoveryPoints(
  client: BackupClient,
  vaultName: string,
  cap = RECOVERY_POINT_CAP,
): Promise<{ points: RecoveryPointByBackupVault[]; truncated: boolean }> {
  const points: RecoveryPointByBackupVault[] = [];
  for await (const page of paginateListRecoveryPointsByBackupVault(
    { client, pageSize: Math.min(1000, Math.max(1, cap)) },
    { BackupVaultName: vaultName },
  )) {
    const items = page.RecoveryPoints ?? [];
    const room = cap - points.length;
    points.push(...items.slice(0, room));
    if (points.length >= cap) return { points, truncated: items.length > room || !!page.NextToken };
  }
  return { points, truncated: false };
}

export function mapBackupVault(
  vault: BackupVaultListMember,
  summary: RecoveryPointSummary,
  truncated: boolean,
  ctx: DiscoveryContext,
  /** False when recovery points could not be listed: totals are then unknown, not zero. */
  listed = true,
): DiscoveredResourceOf<'BACKUP_VAULT'> | null {
  const name = vault.BackupVaultName;
  if (!name) return null;
  return {
    resourceType: 'BACKUP_VAULT',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: name,
    arn: vault.BackupVaultArn ?? `arn:aws:backup:${ctx.region}:${ctx.accountId}:backup-vault:${name}`,
    name,
    // 'unknown' tells rules the recovery-point totals were not collected, so empty totals mean "unknown", not "none".
    state: listed ? 'active' : 'unknown',
    tags: {},
    createdAt: toIso(vault.CreationDate),
    attributes: {
      vaultName: name,
      locked: vault.Locked ?? false,
      truncated,
      ...summary,
    },
  };
}

export interface BackupVaultDiscoveryOptions {
  /** Override for tests. */
  recoveryPointCap?: number;
}

/**
 * AWS Backup vaults with recovery point summaries. Recovery points are listed per vault with bounded
 * concurrency and capped at RECOVERY_POINT_CAP (`truncated: true`). When listing fails for one vault,
 * that vault is reported with state 'unknown', empty totals and `truncated: true`.
 * Ages are computed against `ctx.now` (default: current time).
 */
export async function discoverBackupVaults(
  client: BackupClient,
  ctx: DiscoveryContext,
  options: BackupVaultDiscoveryOptions = {},
): Promise<DiscoveredResourceOf<'BACKUP_VAULT'>[]> {
  const logger = loggerFor(ctx);
  const now = ctx.now ?? new Date();
  const cap = options.recoveryPointCap ?? RECOVERY_POINT_CAP;

  const vaults: BackupVaultListMember[] = [];
  for await (const page of paginateListBackupVaults({ client, pageSize: 100 }, {})) {
    for (const vault of page.BackupVaultList ?? []) {
      if (vault.BackupVaultName) vaults.push(vault);
    }
  }

  const listed = await mapSettledWithConcurrency(vaults, SUB_CALL_CONCURRENCY, (vault) =>
    listRecoveryPoints(client, vault.BackupVaultName as string, cap),
  );

  const out: DiscoveredResourceOf<'BACKUP_VAULT'>[] = [];
  for (const result of listed) {
    let points: RecoveryPointByBackupVault[] = [];
    let truncated = true;
    if (result.status === 'fulfilled') ({ points, truncated } = result.value);
    else {
      logger.warn('ListRecoveryPointsByBackupVault failed; vault totals unknown', {
        region: ctx.region,
        vaultName: result.item.BackupVaultName,
        awsError: awsErrorName(result.reason),
        message: errorMessage(result.reason),
      });
    }
    const mapped = mapBackupVault(
      result.item,
      summarizeRecoveryPoints(points, now),
      truncated,
      ctx,
      result.status === 'fulfilled',
    );
    if (mapped) out.push(mapped);
  }
  return out;
}
