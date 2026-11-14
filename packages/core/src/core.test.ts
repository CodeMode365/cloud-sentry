import { describe, expect, it } from 'vitest';
import type {
  AuthContext,
  FindingRecord,
  PricedRecommendationDraft,
  RecommendationRecord,
} from '@cloudsentry/shared-types';
import { CUSTOMER_ROLE_PERMISSION_STATEMENTS } from '@cloudsentry/shared-types';
import { ForbiddenError } from '@cloudsentry/utilities';
import { requireRole } from './auth/authorization';
import { decodeRefreshCookie, encodeRefreshCookie } from './auth/auth-service';
import { buildOnboardingInstructions } from './accounts/onboarding';
import { buildScheduleExpression, nextExecution, toStandardCron } from './schedules/expressions';
import {
  applyUserStatus,
  mergeFinding,
  mergeRecommendation,
  resolveFinding,
  resolveRecommendation,
} from './lifecycle/finding-lifecycle';

const ctx = (scanId: string, now = '2026-11-01T00:00:00.000Z') => ({ tenantId: 't1', scanId, now });

function draft(overrides: Partial<PricedRecommendationDraft> = {}): PricedRecommendationDraft {
  return {
    recommendationId: 'rec_1',
    findingId: 'fnd_1',
    title: 'Release unassociated Elastic IP',
    description: 'd',
    suggestedAction: { type: 'RELEASE_ADDRESS', summary: 's', steps: ['a'] },
    confidence: 'HIGH',
    riskLevel: 'LOW',
    severity: 'LOW',
    savings: {
      status: 'ESTIMATED',
      estimateType: 'POINT',
      monthly: 3.65,
      annual: 43.8,
      currency: 'USD',
      method: '0.005 x 730',
      assumptions: [],
      pricingSources: [],
      calculatedAt: '2026-11-01T00:00:00.000Z',
    },
    issue: {
      findingId: 'fnd_1',
      ruleId: 'unassociated-eip',
      ruleName: 'Unassociated Elastic IP',
      ruleVersion: 1,
      category: 'UNUSED',
      resourceType: 'ELASTIC_IP',
      resourceKey: 'key',
      accountId: '123456789012',
      region: 'us-east-1',
      resourceId: 'eipalloc-1',
      resourceName: null,
      title: 't',
      description: 'd',
      baseSeverity: 'LOW',
      confidence: 'HIGH',
      riskLevel: 'LOW',
      evidence: [],
      thresholds: {},
      suggestedAction: { type: 'RELEASE_ADDRESS', summary: 's', steps: ['a'] },
      savingsRequest: { kind: 'ELASTIC_IP_RELEASE', region: 'us-east-1' },
    },
    ...overrides,
  };
}

describe('finding lifecycle', () => {
  it('creates, updates, resolves and reopens a finding without duplicates', () => {
    const first = mergeFinding(null, draft(), ctx('scan_1'));
    expect(first.transition).toBe('NEW');
    expect(first.record).toMatchObject({ status: 'OPEN', occurrenceCount: 1, version: 1 });

    const again = mergeFinding(first.record, draft(), ctx('scan_2', '2026-11-02T00:00:00.000Z'));
    expect(again.transition).toBe('UPDATED');
    expect(again.record).toMatchObject({
      occurrenceCount: 2,
      firstDetectedAt: '2026-11-01T00:00:00.000Z',
      lastDetectedAt: '2026-11-02T00:00:00.000Z',
    });

    const replay = mergeFinding(again.record, draft(), ctx('scan_2'));
    expect(replay.transition).toBe('ALREADY_PROCESSED');
    expect(replay.record.occurrenceCount).toBe(2);

    const resolved = resolveFinding(again.record, 'NOT_DETECTED', ctx('scan_3')) as FindingRecord;
    expect(resolved).toMatchObject({ status: 'RESOLVED', resolutionReason: 'NOT_DETECTED' });
    expect(resolveFinding(resolved, 'NOT_DETECTED', ctx('scan_4'))).toBeNull();

    const reopened = mergeFinding(resolved, draft(), ctx('scan_4'));
    expect(reopened.transition).toBe('REOPENED');
    expect(reopened.record).toMatchObject({
      status: 'OPEN',
      reopenCount: 1,
      resolvedAt: null,
      occurrenceCount: 3,
    });
  });

  it('keeps user triage status when the issue is detected again', () => {
    const first = mergeFinding(null, draft(), ctx('scan_1')).record;
    const suppressed = { ...first, status: 'SUPPRESSED' as const };
    expect(mergeFinding(suppressed, draft(), ctx('scan_2')).record.status).toBe('SUPPRESSED');
  });

  it('never stores savings for unpriced findings', () => {
    const unpriced = draft({
      savings: {
        ...draft().savings,
        status: 'UNAVAILABLE',
        monthly: null,
        annual: null,
        unavailableReason: 'no price',
      },
    });
    expect(mergeFinding(null, unpriced, ctx('s')).record.estimatedMonthlySavings).toBeNull();
  });
});

describe('recommendation lifecycle', () => {
  it('records realized savings estimate only for accepted recommendations', () => {
    const rec = mergeRecommendation(null, draft(), ctx('scan_1')).record;
    const accepted = applyUserStatus(rec, 'ACCEPTED', 'u1', 'will do', '2026-11-01T01:00:00.000Z');
    const resolved = resolveRecommendation(accepted, ctx('scan_2')) as RecommendationRecord;
    expect(resolved).toMatchObject({ status: 'RESOLVED', realizedMonthlySavingsEstimate: 3.65 });
    expect(resolved.statusHistory[0]?.status).toBe('RESOLVED');

    const open = resolveRecommendation(rec, ctx('scan_2')) as RecommendationRecord;
    expect(open.realizedMonthlySavingsEstimate).toBeNull();
  });

  it('leaves dismissed recommendations dismissed', () => {
    const rec = mergeRecommendation(null, draft(), ctx('scan_1')).record;
    const dismissed = applyUserStatus(rec, 'DISMISSED', 'u1', null, '2026-11-01T01:00:00.000Z');
    expect(resolveRecommendation(dismissed, ctx('scan_2'))).toBeNull();
    expect(mergeRecommendation(dismissed, draft(), ctx('scan_3')).record.status).toBe('DISMISSED');
  });
});

describe('schedule expressions', () => {
  it('builds EventBridge cron expressions for presets', () => {
    const base = { hour: 3, minute: 15, dayOfWeek: 2 };
    expect(buildScheduleExpression({ ...base, frequency: 'DAILY' })).toBe('cron(15 3 * * ? *)');
    expect(buildScheduleExpression({ ...base, frequency: 'EVERY_6_HOURS' })).toBe('cron(15 0/6 * * ? *)');
    expect(buildScheduleExpression({ ...base, frequency: 'WEEKLY' })).toBe('cron(15 3 ? * 2 *)');
    expect(() =>
      buildScheduleExpression({ ...base, frequency: 'CUSTOM', cronExpression: 'cron(* * * * * *)' }),
    ).toThrow();
  });

  it('converts EventBridge day-of-week numbering', () => {
    expect(toStandardCron('cron(0 2 ? * 2 *)')?.cron).toBe('0 2 * * 1');
    expect(toStandardCron('cron(0 2 ? * 2-6 *)')?.cron).toBe('0 2 * * 1-5');
    expect(toStandardCron('cron(0 2 ? * MON-FRI *)')?.cron).toBe('0 2 * * MON-FRI');
  });

  it('computes the next execution in the schedule timezone', () => {
    const from = new Date('2026-11-14T00:00:00.000Z');
    // 02:00 in Kathmandu (UTC+05:45) is 20:15 UTC the previous day.
    expect(nextExecution('cron(0 2 * * ? *)', 'Asia/Kathmandu', from)?.toISOString()).toBe(
      '2026-11-14T20:15:00.000Z',
    );
    // Weekly Monday (EventBridge 2) 02:00 UTC; 2026-11-14 is a Saturday.
    expect(nextExecution('cron(0 2 ? * 2 *)', 'UTC', from)?.toISOString()).toBe('2026-11-16T02:00:00.000Z');
    expect(nextExecution('cron(0 2 * * ? 2020)', 'UTC', from)).toBeNull();
  });
});

describe('onboarding', () => {
  it('generates a read-only role template bound to the external ID', () => {
    const out = buildOnboardingInstructions({
      platformAccountId: '111111111111',
      customerAccountId: '222222222222',
      roleName: 'CloudSentryReadOnlyRole',
      externalId: 'cs-abc',
    });
    expect(out.roleArn).toBe('arn:aws:iam::222222222222:role/CloudSentryReadOnlyRole');
    expect(out.cloudFormationTemplate).toContain("Default: 'cs-abc'");
    expect(out.cloudFormationTemplate).toContain("'sts:ExternalId': !Ref ExternalId");
    expect(JSON.stringify(out.trustPolicy)).toContain('arn:aws:iam::111111111111:root');
    const actions = CUSTOMER_ROLE_PERMISSION_STATEMENTS.flatMap((s) => [...s.Action]);
    for (const a of actions) expect(a).toMatch(/:(Describe|Get|List)/);
  });
});

describe('authorization and session cookies', () => {
  const viewer: AuthContext = { userId: 'u', tenantId: 't', role: 'VIEWER', email: 'e' };
  it('enforces role ranks', () => {
    expect(() => requireRole(viewer, 'MEMBER')).toThrow(ForbiddenError);
    expect(() => requireRole({ ...viewer, role: 'OWNER' }, 'ADMIN')).not.toThrow();
  });

  it('round-trips refresh cookies and rejects tampered values', () => {
    const v = encodeRefreshCookie('0b6c9f0e-1111-2222-3333-444455556666', 'r'.repeat(40));
    expect(decodeRefreshCookie(v)?.userSub).toBe('0b6c9f0e-1111-2222-3333-444455556666');
    expect(decodeRefreshCookie('nodot')).toBeNull();
    expect(decodeRefreshCookie('../../etc.short')).toBeNull();
  });
});
