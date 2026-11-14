import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { elastiCacheCluster, elastiCacheMetrics } from '../__fixtures__/resources';
import { idleElastiCacheRule as rule } from './idle-elasticache';

const ctx = (o = {}) => ctxFor(rule.defaultThresholds, o);

describe('idle-elasticache', () => {
  it('flags clusters with zero connections over the window (HIGH risk, snapshot first)', () => {
    const out = rule.evaluate(elastiCacheCluster({ utilization: elastiCacheMetrics({ connMax: 0 }) }), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.riskLevel).toBe('HIGH');
    expect(out.confidence).toBe('HIGH');
    expect(out.suggestedAction.type).toBe('DELETE_CACHE_CLUSTER');
    expect(out.suggestedAction.steps.join(' ')).toMatch(/snapshot/i);
    expect(out.savingsRequest).toEqual({
      kind: 'ELASTICACHE_DELETE',
      region: 'us-east-1',
      cacheEngine: 'Redis',
      cacheNodeType: 'cache.r6g.xlarge',
      numNodes: 1,
    });
  });

  it('treats NO_DATA connections as NOT_EVALUATED, never as zero', () => {
    expect(
      rule.evaluate(elastiCacheCluster({ utilization: elastiCacheMetrics({ connMax: null }) }), ctx()),
    ).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRIC_NO_DATA: CurrConnections:Maximum',
    });
  });

  it('does not flag caches with connections, and honours maxConnections', () => {
    const r = elastiCacheCluster({ utilization: elastiCacheMetrics({ connMax: 25 }) });
    expect(rule.evaluate(r, ctx()).outcome).toBe('NOT_DETECTED');
    expect(rule.evaluate(r, ctx({ maxConnections: 30 })).outcome).toBe('DETECTED');
  });

  it('treats observed connections as conclusive but needs coverage to conclude idleness', () => {
    expect(
      rule.evaluate(
        elastiCacheCluster({ utilization: elastiCacheMetrics({ connMax: 5, coverage: 0.2 }) }),
        ctx(),
      ).outcome,
    ).toBe('NOT_DETECTED');
    const out = rule.evaluate(
      elastiCacheCluster({ utilization: elastiCacheMetrics({ connMax: 0, coverage: 0.2 }) }),
      ctx(),
    );
    expect(out.outcome === 'NOT_EVALUATED' && out.reason).toMatch(
      /^INSUFFICIENT_METRIC_COVERAGE: CurrConnections:Maximum/,
    );
  });

  it('notes that Memcached cannot be snapshotted and replication groups are deleted as a whole', () => {
    const out = rule.evaluate(
      elastiCacheCluster({
        attributes: { engine: 'memcached', replicationGroupId: null },
        utilization: elastiCacheMetrics({ connMax: 0 }),
      }),
      ctx(),
    );
    expect(out.outcome === 'DETECTED' && out.suggestedAction.steps.join(' ')).toMatch(
      /cannot be snapshotted/,
    );
    const member = rule.evaluate(
      elastiCacheCluster({
        attributes: { replicationGroupId: 'sessions' },
        utilization: elastiCacheMetrics({ connMax: 0 }),
      }),
      ctx(),
    );
    expect(
      member.outcome === 'DETECTED' && member.evidence.some((e) => e.key === 'cache.replicationGroup'),
    ).toBe(true);
  });
});
