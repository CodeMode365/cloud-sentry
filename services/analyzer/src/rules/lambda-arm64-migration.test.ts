import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { lambdaFunction, lambdaMetrics } from '../__fixtures__/resources';
import { lambdaArm64MigrationRule as rule } from './lambda-arm64-migration';

const ctx = (o = {}) => ctxFor(rule.defaultThresholds, o);
// 1024 MB x 200,000 s per month = 200,000 GB-s
const heavy = () => lambdaMetrics({ durationSumMs: 200_000_000 });

describe('lambda-arm64-migration', () => {
  it('flags heavy x86_64 zip functions on arm64-capable runtimes with LOW confidence', () => {
    const out = rule.evaluate(lambdaFunction({ utilization: heavy() }), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect([out.confidence, out.riskLevel]).toEqual(['LOW', 'MEDIUM']);
    expect(out.suggestedAction.type).toBe('MIGRATE_TO_ARM64');
    expect(out.savingsRequest).toEqual({
      kind: 'LAMBDA_ARM64_MIGRATION',
      region: 'us-east-1',
      memoryMb: 1024,
      monthlyDurationSeconds: 200_000,
    });
    expect(out.evidence.find((e) => e.key === 'compute.monthlyGbSeconds')).toMatchObject({
      value: 200_000,
      threshold: '>= 100000',
    });
  });

  it('does not flag light functions unless the threshold is lowered', () => {
    const r = lambdaFunction({ utilization: lambdaMetrics() }); // 50,000 GB-s
    expect(rule.evaluate(r, ctx()).outcome).toBe('NOT_DETECTED');
    expect(rule.evaluate(r, ctx({ minMonthlyGbSeconds: 10_000 })).outcome).toBe('DETECTED');
  });

  it.each([
    [{ architecture: 'arm64' }],
    [{ packageType: 'Image', runtime: null }],
    [{ runtime: 'python3.7' }],
    [{ runtime: 'java8' }],
    [{ runtime: 'go1.x' }],
    [{ runtime: 'provided' }],
  ])('is NOT_DETECTED for ineligible functions %j', (attributes) => {
    expect(rule.evaluate(lambdaFunction({ attributes, utilization: heavy() }), ctx()).outcome).toBe(
      'NOT_DETECTED',
    );
  });

  it.each(['python3.12', 'java8.al2', 'java21', 'dotnet8', 'ruby3.3', 'provided.al2023', 'nodejs22.x'])(
    'accepts managed runtime %s',
    (runtime) => {
      expect(
        rule.evaluate(lambdaFunction({ attributes: { runtime }, utilization: heavy() }), ctx()).outcome,
      ).toBe('DETECTED');
    },
  );

  it('treats missing duration as NOT_EVALUATED, never as zero', () => {
    expect(
      rule.evaluate(lambdaFunction({ utilization: lambdaMetrics({ durationSumMs: null }) }), ctx()),
    ).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRIC_NO_DATA: Duration:Sum',
    });
    const short = rule.evaluate(lambdaFunction({ utilization: lambdaMetrics({ observableDays: 7 }) }), ctx());
    expect(short.outcome === 'NOT_EVALUATED' && short.reason).toMatch(/^INSUFFICIENT_OBSERVATION_PERIOD/);
  });
});
