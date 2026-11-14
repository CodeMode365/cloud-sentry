import { describe, expect, it } from 'vitest';
import type { DetectionSettings } from '@cloudsentry/shared-types';
import { findingIdFor } from '@cloudsentry/utilities';
import {
  FIXTURE_NOW,
  backupPlan,
  backupVault,
  cloudFrontDistribution,
  cloudFrontMetrics,
  dynamoDbMetrics,
  dynamoDbTable,
  ebsSnapshot,
  ebsVolume,
  ec2Instance,
  efsFileSystem,
  efsMetrics,
  eksCluster,
  eksMetrics,
  elastiCacheCluster,
  elastiCacheMetrics,
  elasticIp,
  idleEc2Metrics,
  lambdaFunction,
  lambdaMetrics,
  natGateway,
  rdsInstance,
  redshiftCluster,
  redshiftMetrics,
  vaultSummary,
} from './__fixtures__/resources';
import { RULE_CATALOG, RULES, getRule, getRuleCatalog } from './catalog';
import { resolveRuleConfig, runDetection } from './engine';
import { defineRule } from './rules/types';
import { idleEc2Rule } from './rules/idle-ec2';

function settings(rules: DetectionSettings['rules'], ignoreTagKey = 'cloudsentry:ignore'): DetectionSettings {
  return {
    tenantId: 't1',
    lookbackDays: 30,
    ignoreTagKey,
    rules,
    updatedAt: FIXTURE_NOW.toISOString(),
    version: 1,
  };
}

describe('runDetection', () => {
  const resources = [
    ec2Instance({ utilization: idleEc2Metrics() }),
    ebsVolume(),
    elasticIp(),
    ebsSnapshot(),
    rdsInstance(),
    natGateway(),
  ];

  it('produces deterministic findings with stable IDs', () => {
    const a = runDetection(resources, { settings: null, now: FIXTURE_NOW });
    const b = runDetection(resources, { settings: null, now: FIXTURE_NOW });
    expect(a).toEqual(b);
    const ec2 = a.issues.find((i) => i.ruleId === 'idle-ec2');
    expect(ec2?.findingId).toBe(findingIdFor('111122223333', 'us-east-1', 'idle-ec2', 'i-0abc1234def567890'));
    expect(a.issues.map((i) => i.ruleId).sort()).toEqual([
      'idle-ec2',
      'old-ebs-snapshots',
      'unassociated-eip',
      'unattached-ebs',
    ]);
    expect(a.rulesExecuted).toHaveLength(RULES.length);
    // RDS and NAT have no metrics -> NOT_EVALUATED, never DETECTED
    const rds = a.evaluations.find((e) => e.ruleId === 'underutilized-rds');
    expect(rds).toMatchObject({ outcome: 'NOT_EVALUATED', reason: 'METRICS_NOT_COLLECTED' });
    expect(a.evaluations).toHaveLength(resources.length);
  });

  it('copies merged thresholds and base severity onto issues', () => {
    const result = runDetection(resources, {
      settings: settings({ 'unattached-ebs': { enabled: true, thresholds: { minAgeDays: 1 } } }),
      now: FIXTURE_NOW,
    });
    const ebs = result.issues.find((i) => i.ruleId === 'unattached-ebs');
    expect(ebs?.thresholds).toEqual({ minAgeDays: 1, highConfidenceAgeDays: 30 });
    expect(ebs?.baseSeverity).toBe('MEDIUM');
    expect(ebs?.resourceKey).toBe(resources[1]?.resourceKey);
  });

  it('records disabled rules and skips their evaluations', () => {
    const result = runDetection(resources, {
      settings: settings({ 'unassociated-eip': { enabled: false, thresholds: {} } }),
      now: FIXTURE_NOW,
    });
    expect(result.rulesExecuted.find((r) => r.ruleId === 'unassociated-eip')?.enabled).toBe(false);
    expect(result.evaluations.some((e) => e.ruleId === 'unassociated-eip')).toBe(false);
    expect(result.issues.some((e) => e.ruleId === 'unassociated-eip')).toBe(false);
  });

  it('excludes resources tagged with the ignore tag (custom key supported)', () => {
    const tagged = [elasticIp({ tags: { 'finops:skip': 'TRUE' } })];
    const result = runDetection(tagged, { settings: settings({}, 'finops:skip'), now: FIXTURE_NOW });
    expect(result.issues).toHaveLength(0);
    expect(result.evaluations[0]).toMatchObject({
      outcome: 'NOT_EVALUATED',
      reason: 'EXCLUDED_BY_TAG: finops:skip=true',
    });
    const defaultTag = runDetection([elasticIp({ tags: { 'cloudsentry:ignore': 'true' } })], {
      settings: null,
      now: FIXTURE_NOW,
    });
    expect(defaultTag.issues).toHaveLength(0);
  });

  it('captures rule exceptions as NOT_EVALUATED instead of aborting', () => {
    const broken = defineRule({
      ...idleEc2Rule,
      ruleId: 'broken-rule',
      evaluate: () => {
        throw new Error('boom');
      },
    });
    const result = runDetection([ec2Instance()], { settings: null, now: FIXTURE_NOW, rules: [broken] });
    expect(result.evaluations[0]).toMatchObject({ outcome: 'NOT_EVALUATED', reason: 'RULE_ERROR: boom' });
  });
});

describe('resolveRuleConfig', () => {
  it('ignores unknown keys and invalid values', () => {
    const cfg = resolveRuleConfig(
      idleEc2Rule,
      settings({
        'idle-ec2': {
          enabled: true,
          thresholds: {
            cpuAverageMaxPercent: 3,
            cpuMaximumMaxPercent: -1,
            bogus: 4,
            networkMaxMbPerDay: Number.NaN,
          },
        },
      }),
    );
    expect(cfg.thresholds).toEqual({ ...idleEc2Rule.defaultThresholds, cpuAverageMaxPercent: 3 });
    expect(cfg.ignoredOverrides.sort()).toEqual(['bogus', 'cpuMaximumMaxPercent', 'networkMaxMbPerDay']);
    expect(resolveRuleConfig(idleEc2Rule, null)).toEqual({
      enabled: true,
      thresholds: idleEc2Rule.defaultThresholds,
      ignoredOverrides: [],
    });
  });
});

const EXTENDED_RULE_IDS = [
  'lambda-overprovisioned-memory',
  'lambda-arm64-migration',
  'lambda-idle-provisioned-concurrency',
  'lambda-near-timeout',
  'idle-eks-cluster',
  'underutilized-eks-nodes',
  'eks-oversized-requests',
  'underutilized-elasticache',
  'idle-elasticache',
  'idle-cloudfront-distribution',
  'cloudfront-compression-disabled',
  'unused-efs',
  'efs-missing-lifecycle',
  'dynamodb-overprovisioned-capacity',
  'dynamodb-capacity-mode',
  'unused-dynamodb-table',
  'idle-redshift-cluster',
  'redshift-pause-schedule',
  'backup-excessive-retention',
  'backup-vault-old-recovery-points',
  'backup-redundant-plans',
];

describe('rule catalog', () => {
  it('lists 27 uniquely identified rules with descriptions for every threshold', () => {
    expect(RULE_CATALOG).toHaveLength(27);
    expect(new Set(RULE_CATALOG.map((r) => r.ruleId)).size).toBe(27);
    for (const r of getRuleCatalog()) {
      expect(Object.keys(r.thresholdDescriptions).sort()).toEqual(Object.keys(r.defaultThresholds).sort());
      for (const description of Object.values(r.thresholdDescriptions))
        expect(description.length).toBeGreaterThan(10);
    }
  });

  it('includes every extended-service rule after the original six, unchanged in order', () => {
    expect(RULES.map((r) => r.ruleId)).toEqual([
      'idle-ec2',
      'unattached-ebs',
      'unassociated-eip',
      'underutilized-rds',
      'old-ebs-snapshots',
      'idle-nat-gateway',
      ...EXTENDED_RULE_IDS,
    ]);
    for (const id of EXTENDED_RULE_IDS) expect(getRule(id)?.ruleId).toBe(id);
  });
});

describe('runDetection with extended services', () => {
  const zero = { avg: 0, p95: 0, max: 0 };
  const extended = () => [
    lambdaFunction({
      attributes: {
        provisionedConcurrency: [{ qualifier: 'live', allocated: 50, requested: 50, status: 'READY' }],
      },
      utilization: lambdaMetrics({
        durationSumMs: 200_000_000,
        durationMaxP95: 25_000,
        pcUtilization: { live: 10 },
      }),
    }),
    eksCluster({
      resourceId: 'idle-eks',
      attributes: {
        clusterName: 'idle-eks',
        nodegroups: [
          {
            name: 'ng',
            status: 'ACTIVE',
            instanceTypes: ['m6i.large'],
            capacityType: 'ON_DEMAND',
            amiType: null,
            desiredSize: 0,
            minSize: 0,
            maxSize: 2,
          },
        ],
      },
    }),
    eksCluster({ utilization: eksMetrics({ cpuReserved: 80 }) }),
    elastiCacheCluster({ utilization: elastiCacheMetrics() }),
    elastiCacheCluster({ resourceId: 'idle-cache', utilization: elastiCacheMetrics({ connMax: 0 }) }),
    cloudFrontDistribution({ utilization: cloudFrontMetrics({ requests: 20 }) }),
    cloudFrontDistribution({ resourceId: 'E2BUSY', utilization: cloudFrontMetrics() }),
    efsFileSystem({ attributes: { numberOfMountTargets: 0 } }),
    // Separate, actively used file system: on the unused one above, the lifecycle finding is superseded.
    efsFileSystem({
      resourceId: 'fs-0active000000000',
      utilization: efsMetrics({ connMax: 5, readBytes: 10 * 1024 ** 3, writeBytes: 1024 ** 3 }),
    }),
    dynamoDbTable({ utilization: dynamoDbMetrics() }),
    dynamoDbTable({
      resourceId: 'spiky',
      utilization: dynamoDbMetrics({ read: { avg: 2, p95: 8, max: 20 }, write: { avg: 1, p95: 3, max: 5 } }),
    }),
    dynamoDbTable({ resourceId: 'idle', utilization: dynamoDbMetrics({ read: zero, write: zero }) }),
    redshiftCluster({ utilization: redshiftMetrics({ connMax: 0 }) }),
    redshiftCluster({ resourceId: 'nightly', utilization: redshiftMetrics({ zeroFraction: 0.6 }) }),
    backupPlan({
      attributes: {
        rules: [
          {
            ruleName: 'forever',
            targetVaultName: 'Default',
            scheduleExpression: null,
            deleteAfterDays: null,
            moveToColdStorageAfterDays: null,
            copyActionCount: 0,
          },
        ],
      },
    }),
    backupVault({
      attributes: {
        recoveryPointCount: 3,
        byResourceType: [vaultSummary('EBS', { 730: { count: 3, bytes: 3 * 1024 ** 3 } })],
        resourcesWithMultiplePlans: [
          {
            resourceArn: 'arn:aws:ec2:us-east-1:111122223333:volume/vol-1',
            resourceType: 'EBS',
            planIds: ['a', 'b'],
          },
        ],
      },
    }),
  ];

  it('detects every extended rule deterministically and keeps the global region in finding IDs', () => {
    const resources = extended();
    const a = runDetection(resources, { settings: null, now: FIXTURE_NOW });
    expect(runDetection(resources, { settings: null, now: FIXTURE_NOW })).toEqual(a);
    expect([...new Set(a.issues.map((i) => i.ruleId))].sort()).toEqual([...EXTENDED_RULE_IDS].sort());
    expect(
      a.evaluations.filter((e) => e.outcome === 'NOT_EVALUATED' && e.reason?.startsWith('RULE_ERROR')),
    ).toEqual([]);
    const cf = a.issues.find((i) => i.ruleId === 'idle-cloudfront-distribution');
    expect(cf?.region).toBe('global');
    expect(cf?.findingId).toBe(
      findingIdFor('111122223333', 'global', 'idle-cloudfront-distribution', 'E1ABCDEF2GHIJK'),
    );
    // Mutual exclusion: each DynamoDB table gets at most one of the two capacity findings.
    for (const id of ['orders', 'spiky', 'idle']) {
      const ids = a.issues.filter((i) => i.resourceId === id).map((i) => i.ruleId);
      expect(ids.filter((r) => r.startsWith('dynamodb-')).length).toBeLessThanOrEqual(1);
    }
    expect(a.issues.find((i) => i.resourceId === 'spiky')?.ruleId).toBe('dynamodb-capacity-mode');
  });

  it('excludes ignore-tagged resources of the new types', () => {
    const tagged = extended().map((r) => ({ ...r, tags: { 'cloudsentry:ignore': 'true' } }));
    const result = runDetection(tagged, { settings: null, now: FIXTURE_NOW });
    expect(result.issues).toHaveLength(0);
    const extendedEvaluations = result.evaluations.filter((e) => EXTENDED_RULE_IDS.includes(e.ruleId));
    expect(extendedEvaluations.length).toBeGreaterThan(0);
    for (const e of extendedEvaluations) {
      expect(e).toMatchObject({
        outcome: 'NOT_EVALUATED',
        reason: 'EXCLUDED_BY_TAG: cloudsentry:ignore=true',
      });
    }
  });

  it('passes the capacity-mode thresholds (with overrides) to the overprovisioned rule', () => {
    const spiky = extended().filter((r) => r.resourceId === 'spiky');
    const stricter = runDetection(spiky, {
      settings: settings({
        'dynamodb-capacity-mode': { enabled: true, thresholds: { minPeakToAverage: 50 } },
      }),
      now: FIXTURE_NOW,
    });
    expect(stricter.issues.map((i) => i.ruleId)).toEqual(['dynamodb-overprovisioned-capacity']);
    // Disabling capacity-mode does not lift the exclusion: the table still meets its condition.
    const disabled = runDetection(spiky, {
      settings: settings({ 'dynamodb-capacity-mode': { enabled: false, thresholds: {} } }),
      now: FIXTURE_NOW,
    });
    expect(disabled.issues).toHaveLength(0);
    expect(disabled.evaluations.find((e) => e.ruleId === 'dynamodb-overprovisioned-capacity')?.outcome).toBe(
      'NOT_DETECTED',
    );
  });
});
