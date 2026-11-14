import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { lambdaFunction, lambdaMetrics } from '../__fixtures__/resources';
import {
  lambdaIdleProvisionedConcurrencyRule as rule,
  provisionedConcurrencyKey,
} from './lambda-idle-provisioned-concurrency';

const ctx = (o = {}) => ctxFor(rule.defaultThresholds, o);
const pc = (qualifier: string, allocated: number) => ({
  qualifier,
  allocated,
  requested: allocated,
  status: 'READY',
});

describe('lambda-idle-provisioned-concurrency', () => {
  it('uses per-qualifier keys', () => {
    expect(provisionedConcurrencyKey('live')).toBe('ProvisionedConcurrencyUtilization:Maximum:live');
    const util = lambdaMetrics({ pcUtilization: { live: 10 } });
    expect(Object.keys(util.metrics)).toContain('ProvisionedConcurrencyUtilization:Maximum:live');
  });

  it('flags an idle allocation and recommends ceil(allocated x peak x 1.5)', () => {
    const r = lambdaFunction({
      attributes: { provisionedConcurrency: [pc('live', 50)] },
      utilization: lambdaMetrics({ pcUtilization: { live: 10 } }),
    });
    const out = rule.evaluate(r, ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.suggestedAction.type).toBe('REDUCE_PROVISIONED_CONCURRENCY');
    // 50 x 10% x 1.5 = 7.5 -> 8
    expect(out.savingsRequest).toEqual({
      kind: 'LAMBDA_PROVISIONED_CONCURRENCY_REDUCE',
      region: 'us-east-1',
      architecture: 'x86_64',
      memoryMb: 1024,
      currentAllocated: 50,
      recommendedAllocated: 8,
    });
    expect(out.evidence.find((e) => e.key === 'provisionedConcurrency.live')).toMatchObject({
      value: 10,
      unit: '%',
      threshold: '< 20',
    });
  });

  it('aggregates idle configurations into one issue and leaves busy ones out', () => {
    const r = lambdaFunction({
      attributes: { provisionedConcurrency: [pc('live', 50), pc('canary', 10), pc('busy', 20)] },
      utilization: lambdaMetrics({ pcUtilization: { live: 10, canary: 5, busy: 50 } }),
    });
    const out = rule.evaluate(r, ctx());
    expect(out.outcome === 'DETECTED' && out.savingsRequest).toMatchObject({
      currentAllocated: 60,
      recommendedAllocated: 9,
    });
  });

  it('recommends 0 when the allocation was never used (data present, zero)', () => {
    const r = lambdaFunction({
      attributes: { provisionedConcurrency: [pc('live', 5)] },
      utilization: lambdaMetrics({ pcUtilization: { live: 0 } }),
    });
    expect(rule.evaluate(r, ctx())).toMatchObject({
      outcome: 'DETECTED',
      savingsRequest: { currentAllocated: 5, recommendedAllocated: 0 },
    });
  });

  it('reads the scanner-scaled percent value as is', () => {
    const r = lambdaFunction({
      attributes: { provisionedConcurrency: [pc('live', 50)] },
      utilization: lambdaMetrics({ pcUtilization: { live: 0.5 } }),
    });
    // 0.5 means 0.5% (not 50%): 50 x 0.5% x 1.5 = 0.375 -> 1
    expect(rule.evaluate(r, ctx())).toMatchObject({
      outcome: 'DETECTED',
      savingsRequest: { recommendedAllocated: 1 },
    });
  });

  it('infers 0% utilization when the metric is NO_DATA and the function had zero invocations', () => {
    const r = lambdaFunction({
      attributes: { provisionedConcurrency: [pc('live', 20)] },
      utilization: lambdaMetrics({ invocations: 0, pcUtilization: { live: null } }),
    });
    const out = rule.evaluate(r, ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.savingsRequest).toMatchObject({ currentAllocated: 20, recommendedAllocated: 0 });
    expect(out.evidence.find((e) => e.key === 'provisionedConcurrency.live')?.label).toMatch(
      /no invocations; utilization metric not emitted/,
    );
    expect(out.evidence.find((e) => e.key === 'invocations.total')).toMatchObject({ value: 0 });
  });

  it('does not infer idleness when invocations are also NO_DATA or were non-zero', () => {
    for (const invocations of [null, 500]) {
      const r = lambdaFunction({
        attributes: { provisionedConcurrency: [pc('live', 20)] },
        utilization: lambdaMetrics({ invocations, pcUtilization: { live: null } }),
      });
      expect(rule.evaluate(r, ctx())).toEqual({
        outcome: 'NOT_EVALUATED',
        reason: 'METRIC_NO_DATA: ProvisionedConcurrencyUtilization:Maximum:live (qualifier live)',
      });
    }
  });

  it('treats NO_DATA for a qualifier as NOT_EVALUATED, never as idle', () => {
    const r = lambdaFunction({
      attributes: { provisionedConcurrency: [pc('live', 50)] },
      utilization: lambdaMetrics({ pcUtilization: { live: null } }),
    });
    expect(rule.evaluate(r, ctx())).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRIC_NO_DATA: ProvisionedConcurrencyUtilization:Maximum:live (qualifier live)',
    });
    const missing = lambdaFunction({
      attributes: { provisionedConcurrency: [pc('v7', 5)] },
      utilization: lambdaMetrics(),
    });
    const out = rule.evaluate(missing, ctx());
    expect(out.outcome === 'NOT_EVALUATED' && out.reason).toMatch(
      /^METRIC_NOT_COLLECTED: ProvisionedConcurrencyUtilization:Maximum:v7/,
    );
  });

  it('still reports evaluable idle configurations when another has no data', () => {
    const r = lambdaFunction({
      attributes: { provisionedConcurrency: [pc('live', 50), pc('beta', 4)] },
      utilization: lambdaMetrics({ pcUtilization: { live: 10, beta: null } }),
    });
    const out = rule.evaluate(r, ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.savingsRequest).toMatchObject({ currentAllocated: 50, recommendedAllocated: 8 });
    expect(out.evidence.find((e) => e.key === 'provisionedConcurrency.notEvaluated')?.value).toMatch(/^beta/);
  });

  it('is NOT_DETECTED without allocations, for busy or irreducible allocations, and honours overrides', () => {
    expect(rule.evaluate(lambdaFunction({ utilization: lambdaMetrics() }), ctx()).outcome).toBe(
      'NOT_DETECTED',
    );
    expect(
      rule.evaluate(lambdaFunction({ attributes: { provisionedConcurrency: [pc('live', 0)] } }), ctx())
        .outcome,
    ).toBe('NOT_DETECTED');
    const busy = lambdaFunction({
      attributes: { provisionedConcurrency: [pc('live', 50)] },
      utilization: lambdaMetrics({ pcUtilization: { live: 50 } }),
    });
    expect(rule.evaluate(busy, ctx()).outcome).toBe('NOT_DETECTED');
    expect(rule.evaluate(busy, ctx({ maxUtilizationPercent: 60 })).outcome).toBe('DETECTED');
    const one = lambdaFunction({
      attributes: { provisionedConcurrency: [pc('live', 1)] },
      utilization: lambdaMetrics({ pcUtilization: { live: 10 } }),
    });
    expect(rule.evaluate(one, ctx()).outcome).toBe('NOT_DETECTED');
  });
});
