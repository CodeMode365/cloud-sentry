import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { lambdaFunction, lambdaMetrics, series, utilizationOf } from '../__fixtures__/resources';
import { lambdaOverprovisionedMemoryRule as rule } from './lambda-overprovisioned-memory';

const ctx = (o = {}) => ctxFor(rule.defaultThresholds, o);

describe('lambda-overprovisioned-memory', () => {
  it('recommends max(128, roundUp64(peak used x 1.3)) and the exact savings request', () => {
    const out = rule.evaluate(lambdaFunction({ utilization: lambdaMetrics() }), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.suggestedAction.type).toBe('RIGHTSIZE_FUNCTION_MEMORY');
    expect([out.confidence, out.riskLevel]).toEqual(['MEDIUM', 'MEDIUM']);
    // 256 MB x 1.3 = 332.8 -> 384; 50,000,000 ms over 30 days -> 50,000 s per month
    expect(out.savingsRequest).toEqual({
      kind: 'LAMBDA_MEMORY_RIGHTSIZE',
      region: 'us-east-1',
      architecture: 'x86_64',
      currentMemoryMb: 1024,
      recommendedMemoryMb: 384,
      monthlyDurationSeconds: 50_000,
    });
    expect(out.evidence.find((e) => e.key === 'memory.utilizationMax')).toMatchObject({
      value: 25,
      unit: '%',
      threshold: '< 40',
    });
    expect(out.suggestedAction.steps.join(' ')).not.toMatch(
      /CloudSentry will|automatically (change|modify)/i,
    );
  });

  it('never recommends less than 128 MB', () => {
    const out = rule.evaluate(
      lambdaFunction({ utilization: lambdaMetrics({ usedMemoryMaxMb: 40, memoryUtilMax: 4 }) }),
      ctx(),
    );
    expect(out.outcome === 'DETECTED' && out.savingsRequest).toMatchObject({ recommendedMemoryMb: 128 });
  });

  it('normalises billed duration to 30 days using the observed days', () => {
    const out = rule.evaluate(
      lambdaFunction({ utilization: lambdaMetrics({ observableDays: 15, durationSumMs: 30_000_000 }) }),
      ctx(),
    );
    expect(out.outcome === 'DETECTED' && out.savingsRequest).toMatchObject({
      monthlyDurationSeconds: 60_000,
    });
  });

  it('is NOT_EVALUATED without Lambda Insights', () => {
    const out = rule.evaluate(lambdaFunction({ utilization: lambdaMetrics({ memoryUtilMax: null }) }), ctx());
    expect(out.outcome).toBe('NOT_EVALUATED');
    expect(out.outcome === 'NOT_EVALUATED' && out.reason).toMatch(
      /^LAMBDA_INSIGHTS_NOT_ENABLED: METRIC_NO_DATA: memory_utilization:Maximum/,
    );
    const absent = utilizationOf([
      series('AWS/Lambda', 'Invocations', 'Sum', { average: 1, sum: 10 }),
      series('AWS/Lambda', 'Duration', 'Sum', { average: 1, sum: 10 }),
    ]);
    const out2 = rule.evaluate(lambdaFunction({ utilization: absent }), ctx());
    expect(out2.outcome === 'NOT_EVALUATED' && out2.reason).toMatch(
      /^LAMBDA_INSIGHTS_NOT_ENABLED: METRIC_NOT_COLLECTED/,
    );
  });

  it('treats missing invocation data as NOT_EVALUATED but zero invocations as NOT_DETECTED', () => {
    expect(
      rule.evaluate(lambdaFunction({ utilization: lambdaMetrics({ invocations: null }) }), ctx()),
    ).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRIC_NO_DATA: Invocations:Sum',
    });
    expect(
      rule.evaluate(lambdaFunction({ utilization: lambdaMetrics({ invocations: 0 }) }), ctx()).outcome,
    ).toBe('NOT_DETECTED');
    expect(rule.evaluate(lambdaFunction(), ctx())).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRICS_NOT_COLLECTED',
    });
  });

  it('skips small functions and well-used memory, and honours threshold overrides', () => {
    expect(
      rule.evaluate(lambdaFunction({ attributes: { memoryMb: 256 }, utilization: lambdaMetrics() }), ctx())
        .outcome,
    ).toBe('NOT_DETECTED');
    const busy = lambdaFunction({ utilization: lambdaMetrics({ memoryUtilMax: 55, usedMemoryMaxMb: 300 }) });
    expect(rule.evaluate(busy, ctx()).outcome).toBe('NOT_DETECTED');
    expect(rule.evaluate(busy, ctx({ maxMemoryUtilizationPercent: 60 })).outcome).toBe('DETECTED');
    const small = lambdaFunction({
      attributes: { memoryMb: 256 },
      utilization: lambdaMetrics({ usedMemoryMaxMb: 60 }),
    });
    expect(rule.evaluate(small, ctx({ minMemoryMb: 128 })).outcome).toBe('DETECTED');
  });

  it('is NOT_DETECTED when the recommendation would not be smaller', () => {
    const r = lambdaFunction({
      attributes: { memoryMb: 512 },
      utilization: lambdaMetrics({ usedMemoryMaxMb: 400, memoryUtilMax: 30 }),
    });
    expect(rule.evaluate(r, ctx()).outcome).toBe('NOT_DETECTED');
  });

  it('gates on observation days and (only when configured) coverage', () => {
    const short = rule.evaluate(
      lambdaFunction({ utilization: lambdaMetrics({ observableDays: 10 }) }),
      ctx(),
    );
    expect(short.outcome === 'NOT_EVALUATED' && short.reason).toMatch(/^INSUFFICIENT_OBSERVATION_PERIOD/);
    const sparse = lambdaFunction({ utilization: lambdaMetrics({ coverage: 0.05 }) });
    expect(rule.evaluate(sparse, ctx()).outcome).toBe('DETECTED');
    const gated = rule.evaluate(sparse, ctx({ minCoverage: 0.8 }));
    expect(gated.outcome === 'NOT_EVALUATED' && gated.reason).toMatch(
      /^INSUFFICIENT_METRIC_COVERAGE: Invocations:Sum/,
    );
  });

  it('drops the savings request when billed duration is unavailable', () => {
    const out = rule.evaluate(lambdaFunction({ utilization: lambdaMetrics({ durationSumMs: null }) }), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.savingsRequest).toBeNull();
    expect(out.evidence.some((e) => e.key === 'pricing.unsupported')).toBe(true);
  });
});
