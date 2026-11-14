import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { lambdaFunction, lambdaMetrics, series, utilizationOf } from '../__fixtures__/resources';
import { lambdaNearTimeoutRule as rule } from './lambda-near-timeout';

const ctx = (o = {}) => ctxFor(rule.defaultThresholds, o);

describe('lambda-near-timeout', () => {
  it('flags functions whose p95 hourly maximum duration reaches 80% of the timeout, with LOW severity and no savings', () => {
    expect(rule.defaultSeverity).toBe('LOW');
    const out = rule.evaluate(
      lambdaFunction({ utilization: lambdaMetrics({ durationMaxP95: 25_000 }) }),
      ctx(),
    );
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.suggestedAction.type).toBe('REVIEW_FUNCTION_DURATION');
    expect(out.savingsRequest).toBeNull();
    expect(out.evidence.find((e) => e.key === 'duration.maxP95Ms')).toMatchObject({
      value: 25_000,
      unit: 'ms',
      threshold: '>= 24000 (0.8 x timeout)',
    });
    expect(out.evidence.find((e) => e.key === 'errors.total')?.value).toBe(3);
  });

  it('does not flag fast functions unless the ratio is lowered', () => {
    const r = lambdaFunction({ utilization: lambdaMetrics({ durationMaxP95: 2_000 }) });
    expect(rule.evaluate(r, ctx()).outcome).toBe('NOT_DETECTED');
    expect(rule.evaluate(r, ctx({ timeoutRatio: 0.05 })).outcome).toBe('DETECTED');
  });

  it('requires invocations and never treats missing duration as zero', () => {
    expect(
      rule.evaluate(
        lambdaFunction({ utilization: lambdaMetrics({ invocations: 0, durationMaxP95: 29_000 }) }),
        ctx(),
      ).outcome,
    ).toBe('NOT_DETECTED');
    const noDuration = utilizationOf([
      series('AWS/Lambda', 'Invocations', 'Sum', { average: 1, sum: 100 }),
      series('AWS/Lambda', 'Duration', 'Maximum', { availability: 'NO_DATA' }),
    ]);
    expect(rule.evaluate(lambdaFunction({ utilization: noDuration }), ctx())).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRIC_NO_DATA: Duration:Maximum',
    });
    expect(rule.evaluate(lambdaFunction(), ctx()).outcome).toBe('NOT_EVALUATED');
  });
});
