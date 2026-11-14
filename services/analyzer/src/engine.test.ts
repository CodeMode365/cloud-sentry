import { describe, expect, it } from 'vitest';
import type { DetectionSettings } from '@cloudsentry/shared-types';
import { findingIdFor } from '@cloudsentry/utilities';
import {
  FIXTURE_NOW,
  ebsSnapshot,
  ebsVolume,
  ec2Instance,
  elasticIp,
  idleEc2Metrics,
  natGateway,
  rdsInstance,
} from './__fixtures__/resources';
import { RULE_CATALOG, RULES, getRuleCatalog } from './catalog';
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

describe('rule catalog', () => {
  it('lists six uniquely identified rules with descriptions for every threshold', () => {
    expect(RULE_CATALOG).toHaveLength(6);
    expect(new Set(RULE_CATALOG.map((r) => r.ruleId)).size).toBe(6);
    for (const r of getRuleCatalog()) {
      expect(Object.keys(r.thresholdDescriptions).sort()).toEqual(Object.keys(r.defaultThresholds).sort());
    }
  });
});
