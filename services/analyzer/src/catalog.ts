import type { RuleDefinitionSummary } from '@cloudsentry/shared-types';
import { idleEc2Rule } from './rules/idle-ec2';
import { unattachedEbsRule } from './rules/unattached-ebs';
import { unassociatedEipRule } from './rules/unassociated-eip';
import { underutilizedRdsRule } from './rules/underutilized-rds';
import { oldEbsSnapshotsRule } from './rules/old-ebs-snapshots';
import { idleNatGatewayRule } from './rules/idle-nat-gateway';
import { lambdaOverprovisionedMemoryRule } from './rules/lambda-overprovisioned-memory';
import { lambdaArm64MigrationRule } from './rules/lambda-arm64-migration';
import { lambdaIdleProvisionedConcurrencyRule } from './rules/lambda-idle-provisioned-concurrency';
import { lambdaNearTimeoutRule } from './rules/lambda-near-timeout';
import { idleEksClusterRule } from './rules/idle-eks-cluster';
import { underutilizedEksNodesRule } from './rules/underutilized-eks-nodes';
import { eksOversizedRequestsRule } from './rules/eks-oversized-requests';
import { underutilizedElastiCacheRule } from './rules/underutilized-elasticache';
import { idleElastiCacheRule } from './rules/idle-elasticache';
import { idleCloudFrontDistributionRule } from './rules/idle-cloudfront-distribution';
import { cloudFrontCompressionDisabledRule } from './rules/cloudfront-compression-disabled';
import { unusedEfsRule } from './rules/unused-efs';
import { efsMissingLifecycleRule } from './rules/efs-missing-lifecycle';
import { dynamoDbOverprovisionedCapacityRule } from './rules/dynamodb-overprovisioned-capacity';
import { dynamoDbCapacityModeRule } from './rules/dynamodb-capacity-mode';
import { unusedDynamoDbTableRule } from './rules/unused-dynamodb-table';
import { idleRedshiftClusterRule } from './rules/idle-redshift-cluster';
import { redshiftPauseScheduleRule } from './rules/redshift-pause-schedule';
import { backupExcessiveRetentionRule } from './rules/backup-excessive-retention';
import { backupVaultOldRecoveryPointsRule } from './rules/backup-vault-old-recovery-points';
import { backupRedundantPlansRule } from './rules/backup-redundant-plans';
import type { AnyRuleDefinition } from './rules/types';

/** All detection rules, in evaluation order. */
export const RULES: readonly AnyRuleDefinition[] = [
  idleEc2Rule,
  unattachedEbsRule,
  unassociatedEipRule,
  underutilizedRdsRule,
  oldEbsSnapshotsRule,
  idleNatGatewayRule,
  lambdaOverprovisionedMemoryRule,
  lambdaArm64MigrationRule,
  lambdaIdleProvisionedConcurrencyRule,
  lambdaNearTimeoutRule,
  idleEksClusterRule,
  underutilizedEksNodesRule,
  eksOversizedRequestsRule,
  underutilizedElastiCacheRule,
  idleElastiCacheRule,
  idleCloudFrontDistributionRule,
  cloudFrontCompressionDisabledRule,
  unusedEfsRule,
  efsMissingLifecycleRule,
  dynamoDbOverprovisionedCapacityRule,
  dynamoDbCapacityModeRule,
  unusedDynamoDbTableRule,
  idleRedshiftClusterRule,
  redshiftPauseScheduleRule,
  backupExcessiveRetentionRule,
  backupVaultOldRecoveryPointsRule,
  backupRedundantPlansRule,
];

export function toRuleSummary(rule: AnyRuleDefinition): RuleDefinitionSummary {
  return {
    ruleId: rule.ruleId,
    name: rule.name,
    description: rule.description,
    resourceType: rule.resourceType,
    category: rule.category,
    version: rule.version,
    defaultSeverity: rule.defaultSeverity,
    defaultThresholds: { ...rule.defaultThresholds },
    thresholdDescriptions: { ...rule.thresholdDescriptions },
  };
}

export const RULE_CATALOG: readonly RuleDefinitionSummary[] = RULES.map(toRuleSummary);

export function getRuleCatalog(): RuleDefinitionSummary[] {
  return RULE_CATALOG.map((r) => ({ ...r, defaultThresholds: { ...r.defaultThresholds } }));
}

export function getRule(ruleId: string): AnyRuleDefinition | undefined {
  return RULES.find((r) => r.ruleId === ruleId);
}
