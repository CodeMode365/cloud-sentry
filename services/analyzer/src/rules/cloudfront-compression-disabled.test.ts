import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { cloudFrontDistribution, cloudFrontMetrics } from '../__fixtures__/resources';
import { cloudFrontCompressionDisabledRule as rule } from './cloudfront-compression-disabled';

const ctx = (o = {}) => ctxFor(rule.defaultThresholds, o);

describe('cloudfront-compression-disabled', () => {
  it('flags uncompressed distributions with meaningful traffic (LOW severity, no savings)', () => {
    expect(rule.defaultSeverity).toBe('LOW');
    const out = rule.evaluate(cloudFrontDistribution({ utilization: cloudFrontMetrics() }), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.suggestedAction.type).toBe('ENABLE_COMPRESSION');
    expect(out.savingsRequest).toBeNull();
    expect(out.evidence.find((e) => e.key === 'traffic.gbPerMonth')).toMatchObject({
      value: 50,
      unit: 'GB',
      threshold: '>= 10',
    });
  });

  it('normalises traffic to 30 days', () => {
    // 6 GB over 15 days = 12 GB per month
    const r = cloudFrontDistribution({ utilization: cloudFrontMetrics({ bytes: 6e9, observableDays: 15 }) });
    expect(rule.evaluate(r, ctx()).outcome).toBe('DETECTED');
  });

  it('ignores compressed, disabled or low-traffic distributions; unknown setting is NOT_EVALUATED', () => {
    const util = cloudFrontMetrics();
    expect(
      rule.evaluate(
        cloudFrontDistribution({ attributes: { defaultCacheBehaviorCompress: true }, utilization: util }),
        ctx(),
      ).outcome,
    ).toBe('NOT_DETECTED');
    expect(
      rule.evaluate(cloudFrontDistribution({ attributes: { enabled: false }, utilization: util }), ctx())
        .outcome,
    ).toBe('NOT_DETECTED');
    expect(
      rule.evaluate(
        cloudFrontDistribution({ attributes: { defaultCacheBehaviorCompress: null }, utilization: util }),
        ctx(),
      ),
    ).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'COMPRESSION_SETTING_UNKNOWN',
    });
    const low = cloudFrontDistribution({ utilization: cloudFrontMetrics({ bytes: 5e9 }) });
    expect(rule.evaluate(low, ctx()).outcome).toBe('NOT_DETECTED');
    expect(rule.evaluate(low, ctx({ minGbPerMonth: 4 })).outcome).toBe('DETECTED');
  });

  it('treats high traffic as conclusive at any coverage, but low traffic needs coverage; NO_DATA is not zero', () => {
    expect(
      rule.evaluate(cloudFrontDistribution({ utilization: cloudFrontMetrics({ coverage: 0.1 }) }), ctx())
        .outcome,
    ).toBe('DETECTED');
    const out = rule.evaluate(
      cloudFrontDistribution({ utilization: cloudFrontMetrics({ bytes: 1e9, coverage: 0.1 }) }),
      ctx(),
    );
    expect(out.outcome === 'NOT_EVALUATED' && out.reason).toMatch(
      /^INSUFFICIENT_METRIC_COVERAGE: BytesDownloaded:Sum/,
    );
    expect(
      rule.evaluate(cloudFrontDistribution({ utilization: cloudFrontMetrics({ bytes: null }) }), ctx()),
    ).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRIC_NO_DATA: BytesDownloaded:Sum',
    });
  });
});
