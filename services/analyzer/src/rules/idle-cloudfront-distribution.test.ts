import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { cloudFrontDistribution, cloudFrontMetrics } from '../__fixtures__/resources';
import { idleCloudFrontDistributionRule as rule } from './idle-cloudfront-distribution';

const ctx = (o = {}) => ctxFor(rule.defaultThresholds, o);

describe('idle-cloudfront-distribution', () => {
  it('flags enabled distributions with almost no requests, without claiming savings', () => {
    const r = cloudFrontDistribution({ utilization: cloudFrontMetrics({ requests: 20 }) });
    expect(r.region).toBe('global');
    const out = rule.evaluate(r, ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.suggestedAction.type).toBe('REVIEW_DISTRIBUTION');
    expect(out.savingsRequest).toBeNull();
    expect(out.evidence.find((e) => e.key === 'requests.total')).toMatchObject({
      value: 20,
      threshold: '< 100',
    });
  });

  it('treats zero requests (data present) as idle but NO_DATA as NOT_EVALUATED', () => {
    expect(
      rule.evaluate(cloudFrontDistribution({ utilization: cloudFrontMetrics({ requests: 0 }) }), ctx())
        .outcome,
    ).toBe('DETECTED');
    expect(
      rule.evaluate(cloudFrontDistribution({ utilization: cloudFrontMetrics({ requests: null }) }), ctx()),
    ).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRIC_NO_DATA: Requests:Sum',
    });
  });

  it('treats traffic as conclusive at any coverage but needs coverage to conclude idleness', () => {
    expect(
      rule.evaluate(
        cloudFrontDistribution({ utilization: cloudFrontMetrics({ requests: 1_000, coverage: 0.05 }) }),
        ctx(),
      ).outcome,
    ).toBe('NOT_DETECTED');
    const sparse = cloudFrontDistribution({
      utilization: cloudFrontMetrics({ requests: 20, coverage: 0.05 }),
    });
    const out = rule.evaluate(sparse, ctx());
    expect(out.outcome === 'NOT_EVALUATED' && out.reason).toMatch(
      /^INSUFFICIENT_METRIC_COVERAGE: Requests:Sum/,
    );
    expect(rule.evaluate(sparse, ctx({ minCoverage: 0 })).outcome).toBe('DETECTED');
  });

  it('ignores disabled distributions and honours maxRequests', () => {
    expect(
      rule.evaluate(
        cloudFrontDistribution({
          attributes: { enabled: false },
          utilization: cloudFrontMetrics({ requests: 0 }),
        }),
        ctx(),
      ).outcome,
    ).toBe('NOT_DETECTED');
    const r = cloudFrontDistribution({ utilization: cloudFrontMetrics({ requests: 20 }) });
    expect(rule.evaluate(r, ctx({ maxRequests: 10 })).outcome).toBe('NOT_DETECTED');
  });

  it('works without a creation time (CloudFront has none) using the observed period', () => {
    const r = cloudFrontDistribution({
      createdAt: null,
      utilization: cloudFrontMetrics({ requests: 5, observableDays: 30 }),
    });
    expect(rule.evaluate(r, ctx()).outcome).toBe('DETECTED');
    expect(rule.evaluate(cloudFrontDistribution(), ctx())).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRICS_NOT_COLLECTED',
    });
  });
});
