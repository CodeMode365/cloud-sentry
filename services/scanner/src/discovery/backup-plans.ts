import {
  GetBackupPlanCommand,
  paginateListBackupPlans,
  type BackupClient,
  type BackupPlansListMember,
  type BackupRule,
} from '@aws-sdk/client-backup';
import type { BackupPlanRuleSummary, DiscoveredResourceOf } from '@cloudsentry/shared-types';
import { awsErrorName, errorMessage, mapSettledWithConcurrency } from '@cloudsentry/utilities';
import {
  isNotFoundError,
  loggerFor,
  orNull,
  SUB_CALL_CONCURRENCY,
  toIso,
  type DiscoveryContext,
} from './common';

export function mapBackupRule(rule: BackupRule): BackupPlanRuleSummary {
  return {
    ruleName: rule.RuleName ?? 'unknown',
    targetVaultName: orNull(rule.TargetBackupVaultName),
    scheduleExpression: orNull(rule.ScheduleExpression),
    deleteAfterDays: orNull(rule.Lifecycle?.DeleteAfterDays),
    moveToColdStorageAfterDays: orNull(rule.Lifecycle?.MoveToColdStorageAfterDays),
    copyActionCount: rule.CopyActions?.length ?? 0,
  };
}

export function mapBackupPlan(
  plan: BackupPlansListMember,
  rules: BackupPlanRuleSummary[],
  ctx: DiscoveryContext,
): DiscoveredResourceOf<'BACKUP_PLAN'> | null {
  const id = plan.BackupPlanId;
  if (!id) return null;
  const name = plan.BackupPlanName ?? id;
  return {
    resourceType: 'BACKUP_PLAN',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: id,
    arn: plan.BackupPlanArn ?? `arn:aws:backup:${ctx.region}:${ctx.accountId}:backup-plan:${id}`,
    name,
    state: 'active',
    tags: {},
    createdAt: toIso(plan.CreationDate),
    attributes: {
      backupPlanId: id,
      backupPlanName: name,
      versionId: orNull(plan.VersionId),
      lastExecutionDate: toIso(plan.LastExecutionDate),
      rules,
    },
  };
}

/**
 * AWS Backup plans with their rules (GetBackupPlan per plan, bounded concurrency). A plan deleted
 * mid-scan is skipped; any other GetBackupPlan failure keeps the plan with `rules: []`.
 */
export async function discoverBackupPlans(
  client: BackupClient,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'BACKUP_PLAN'>[]> {
  const logger = loggerFor(ctx);
  const plans: BackupPlansListMember[] = [];
  for await (const page of paginateListBackupPlans({ client, pageSize: 100 }, {})) {
    for (const plan of page.BackupPlansList ?? []) {
      if (plan.BackupPlanId) plans.push(plan);
    }
  }

  const details = await mapSettledWithConcurrency(plans, SUB_CALL_CONCURRENCY, (plan) =>
    client.send(new GetBackupPlanCommand({ BackupPlanId: plan.BackupPlanId, VersionId: plan.VersionId })),
  );

  const out: DiscoveredResourceOf<'BACKUP_PLAN'>[] = [];
  for (const result of details) {
    let rules: BackupPlanRuleSummary[] = [];
    if (result.status === 'fulfilled') {
      rules = (result.value.BackupPlan?.Rules ?? []).map(mapBackupRule);
    } else if (isNotFoundError(result.reason)) {
      continue;
    } else {
      logger.warn('GetBackupPlan failed; plan rules unknown', {
        region: ctx.region,
        backupPlanId: result.item.BackupPlanId,
        awsError: awsErrorName(result.reason),
        message: errorMessage(result.reason),
      });
    }
    const mapped = mapBackupPlan(result.item, rules, ctx);
    if (mapped) out.push(mapped);
  }
  return out;
}
