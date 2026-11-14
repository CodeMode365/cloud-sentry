import { describe, expect, it } from 'vitest';
import type { BackupPlanRuleSummary } from '@cloudsentry/shared-types';
import { ctxFor } from '../__fixtures__/context';
import { backupPlan, backupVault, GIB, vaultSummary } from '../__fixtures__/resources';
import { backupExcessiveRetentionRule as planRule } from './backup-excessive-retention';
import { backupRedundantPlansRule as redundantRule } from './backup-redundant-plans';
import {
  backupVaultOldRecoveryPointsRule as vaultRule,
  snapToAgeBucket,
} from './backup-vault-old-recovery-points';

const planCtx = (o = {}) => ctxFor(planRule.defaultThresholds, o);
const vaultCtx = (o = {}) => ctxFor(vaultRule.defaultThresholds, o);
const rule = (o: Partial<BackupPlanRuleSummary>): BackupPlanRuleSummary => ({
  ruleName: 'r',
  targetVaultName: 'Default',
  scheduleExpression: null,
  deleteAfterDays: 35,
  moveToColdStorageAfterDays: null,
  copyActionCount: 0,
  ...o,
});

describe('backup-excessive-retention', () => {
  it('flags indefinite and over-threshold rules with LOW confidence and no savings', () => {
    const r = backupPlan({
      attributes: {
        rules: [
          rule({ ruleName: 'daily' }),
          rule({ ruleName: 'forever', deleteAfterDays: null }),
          rule({ ruleName: 'yearly', deleteAfterDays: 400 }),
        ],
      },
    });
    const out = planRule.evaluate(r, planCtx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.confidence).toBe('LOW');
    expect(out.suggestedAction.type).toBe('REDUCE_BACKUP_RETENTION');
    expect(out.savingsRequest).toBeNull();
    expect(out.evidence.find((e) => e.key === 'rule.forever.retentionDays')?.value).toBe(
      'retained indefinitely',
    );
    expect(out.evidence.find((e) => e.key === 'rule.yearly.retentionDays')).toMatchObject({
      value: 400,
      threshold: '<= 365',
    });
    expect(out.evidence.some((e) => e.key === 'rule.daily.retentionDays')).toBe(false);
  });

  it('is NOT_DETECTED within retention (boundary inclusive) and honours overrides', () => {
    expect(planRule.evaluate(backupPlan(), planCtx()).outcome).toBe('NOT_DETECTED');
    expect(
      planRule.evaluate(backupPlan({ attributes: { rules: [rule({ deleteAfterDays: 365 })] } }), planCtx())
        .outcome,
    ).toBe('NOT_DETECTED');
    const long = backupPlan({ attributes: { rules: [rule({ deleteAfterDays: 400 })] } });
    expect(planRule.evaluate(long, planCtx({ maxRetentionDays: 500 })).outcome).toBe('NOT_DETECTED');
    expect(planRule.evaluate(backupPlan({ state: 'unknown' }), planCtx()).outcome).toBe('NOT_EVALUATED');
  });
});

describe('backup-vault-old-recovery-points', () => {
  const vault = (o: Parameters<typeof backupVault>[0] = {}) =>
    backupVault({
      ...o,
      attributes: {
        recoveryPointCount: 16,
        byResourceType: [
          vaultSummary('EBS', { 365: { count: 3, bytes: 300 * GIB }, 730: { count: 1, bytes: 100 * GIB } }),
          vaultSummary('EC2', { 365: { count: 1, bytes: 20 * GIB } }),
          vaultSummary('RDS', { 365: { count: 2, bytes: 50 * GIB } }),
          vaultSummary('EFS', { 0: { count: 4, bytes: 5 * GIB }, 180: { count: 5, bytes: 10 * GIB } }),
        ],
        ...(o.attributes ?? {}),
      },
    });

  it('splits EBS/EC2 bytes from other bytes beyond retention (LOW confidence, HIGH risk)', () => {
    const out = vaultRule.evaluate(vault(), vaultCtx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect([out.confidence, out.riskLevel]).toEqual(['LOW', 'HIGH']);
    expect(out.savingsRequest).toEqual({
      kind: 'BACKUP_RETENTION_REDUCE',
      region: 'us-east-1',
      ebsGbBeyondRetention: 420,
      otherGbBeyondRetention: 50,
    });
    expect(out.evidence.find((e) => e.key === 'recoveryPoints.oldCount')?.value).toBe(7);
    expect(out.evidence.some((e) => e.key === 'threshold.snapped')).toBe(false);
  });

  it('snaps thresholds up to the next age bucket boundary', () => {
    expect([0, 1, 30, 31, 180, 200, 365, 400, 730, 731].map(snapToAgeBucket)).toEqual([
      0,
      30,
      30,
      90,
      180,
      365,
      365,
      730,
      730,
      null,
    ]);
    const snapped = vaultRule.evaluate(vault(), vaultCtx({ maxRetentionDays: 400 }));
    expect(snapped.outcome === 'DETECTED' && snapped.savingsRequest).toMatchObject({
      ebsGbBeyondRetention: 100,
      otherGbBeyondRetention: 0,
    });
    expect(
      snapped.outcome === 'DETECTED' && snapped.evidence.find((e) => e.key === 'threshold.snapped')?.value,
    ).toMatch(/400 days was snapped up to the 730-day/);
    const lower = vaultRule.evaluate(vault(), vaultCtx({ maxRetentionDays: 180 }));
    expect(lower.outcome === 'DETECTED' && lower.savingsRequest).toMatchObject({
      ebsGbBeyondRetention: 420,
      otherGbBeyondRetention: 60,
    });
    expect(vaultRule.evaluate(vault(), vaultCtx({ maxRetentionDays: 1000 }))).toMatchObject({
      outcome: 'NOT_EVALUATED',
      reason: expect.stringMatching(/^THRESHOLD_BEYOND_AGE_BUCKETS/),
    });
  });

  it('is NOT_DETECTED when nothing is old or the vault is empty', () => {
    const young = backupVault({
      attributes: {
        recoveryPointCount: 4,
        byResourceType: [vaultSummary('EBS', { 30: { count: 4, bytes: 9 * GIB } })],
      },
    });
    expect(vaultRule.evaluate(young, vaultCtx()).outcome).toBe('NOT_DETECTED');
    expect(vaultRule.evaluate(backupVault(), vaultCtx()).outcome).toBe('NOT_DETECTED');
  });

  it('does not read failed listings as empty vaults', () => {
    const failed = backupVault({ state: 'unknown', attributes: { truncated: true } });
    for (const out of [vaultRule.evaluate(failed, vaultCtx()), redundantRule.evaluate(failed, ctxFor({}))]) {
      expect(out.outcome === 'NOT_EVALUATED' && out.reason).toMatch(/^RECOVERY_POINTS_UNAVAILABLE/);
    }
  });

  it('treats a truncated listing as a lower bound: may detect, never concludes NOT_DETECTED', () => {
    const truncated = vaultRule.evaluate(vault({ attributes: { truncated: true } }), vaultCtx());
    expect(truncated.outcome).toBe('DETECTED');
    if (truncated.outcome !== 'DETECTED') return;
    expect(truncated.description).toMatch(/at least 7 recovery point/);
    expect(truncated.evidence.find((e) => e.key === 'recoveryPoints.oldGib')?.label).toMatch(/at least/);
    const nothing = backupVault({
      attributes: { truncated: true, recoveryPointCount: 5000, byResourceType: [] },
    });
    expect(vaultRule.evaluate(nothing, vaultCtx()).outcome === 'NOT_EVALUATED').toBe(true);
    expect(redundantRule.evaluate(nothing, ctxFor({}))).toMatchObject({
      outcome: 'NOT_EVALUATED',
      reason: expect.stringMatching(/^TRUNCATED_LISTING/),
    });
  });

  it('notes Vault Lock', () => {
    const out = vaultRule.evaluate(vault({ attributes: { locked: true } }), vaultCtx());
    expect(out.outcome === 'DETECTED' && out.evidence.some((e) => e.key === 'vault.lockNote')).toBe(true);
  });
});

describe('backup-redundant-plans', () => {
  const overlaps = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      resourceArn: `arn:aws:ec2:us-east-1:111122223333:volume/vol-${String(i).padStart(3, '0')}`,
      resourceType: 'EBS',
      planIds: ['plan-b', 'plan-a'],
    }));

  it('lists up to 10 resources with plan IDs, MEDIUM confidence and no savings', () => {
    const out = redundantRule.evaluate(
      backupVault({ attributes: { resourcesWithMultiplePlans: overlaps(12) } }),
      ctxFor({}),
    );
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.confidence).toBe('MEDIUM');
    expect(out.suggestedAction.type).toBe('CONSOLIDATE_BACKUP_PLANS');
    expect(out.savingsRequest).toBeNull();
    expect(
      out.evidence.filter((e) => e.key.startsWith('overlap.') && /^overlap\.\d+$/.test(e.key)),
    ).toHaveLength(10);
    expect(out.evidence.find((e) => e.key === 'overlap.1')?.value).toBe('plan-a, plan-b');
    expect(out.evidence.find((e) => e.key === 'overlap.notListed')?.value).toBe(2);
  });

  it('is NOT_DETECTED without overlaps on a complete listing', () => {
    expect(redundantRule.evaluate(backupVault(), ctxFor({})).outcome).toBe('NOT_DETECTED');
  });
});
