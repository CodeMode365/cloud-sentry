import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { elastiCacheCluster, elastiCacheMetrics } from '../__fixtures__/resources';
import { underutilizedElastiCacheRule as rule } from './underutilized-elasticache';

const ctx = (o = {}) => ctxFor(rule.defaultThresholds, o);

describe('underutilized-elasticache', () => {
  it('recommends the next smaller node type using engine CPU for Redis', () => {
    const out = rule.evaluate(elastiCacheCluster({ utilization: elastiCacheMetrics() }), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.suggestedAction.type).toBe('RIGHTSIZE_CACHE_NODE');
    expect(out.confidence).toBe('HIGH');
    expect(out.savingsRequest).toEqual({
      kind: 'ELASTICACHE_RIGHTSIZE',
      region: 'us-east-1',
      cacheEngine: 'Redis',
      currentNodeType: 'cache.r6g.xlarge',
      targetNodeType: 'cache.r6g.large',
      numNodes: 1,
    });
    expect(out.evidence.find((e) => e.key === 'cpu.metric')?.value).toBe('EngineCPUUtilization');
  });

  it('falls back to CPUUtilization when engine CPU is not published', () => {
    const out = rule.evaluate(
      elastiCacheCluster({ utilization: elastiCacheMetrics({ engineCpuAvg: null }) }),
      ctx(),
    );
    expect(out.outcome === 'DETECTED' && out.evidence.find((e) => e.key === 'cpu.metric')?.value).toBe(
      'CPUUtilization',
    );
  });

  it('skips the memory check for Memcached with LOW confidence', () => {
    const out = rule.evaluate(
      elastiCacheCluster({
        attributes: { engine: 'memcached', cacheNodeType: 'cache.t3.small' },
        utilization: elastiCacheMetrics({ engineCpuAvg: null, memMax: null }),
      }),
      ctx(),
    );
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.confidence).toBe('LOW');
    expect(out.savingsRequest).toMatchObject({ cacheEngine: 'Memcached', targetNodeType: 'cache.t3.micro' });
    expect(out.evidence.some((e) => e.key === 'memory.note')).toBe(true);
  });

  it('requires memory data for Redis/Valkey (NO_DATA is not zero)', () => {
    const out = rule.evaluate(
      elastiCacheCluster({ utilization: elastiCacheMetrics({ memMax: null }) }),
      ctx(),
    );
    expect(out).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRIC_NO_DATA: DatabaseMemoryUsagePercentage:Maximum',
    });
  });

  it('does not flag busy caches unless thresholds are raised', () => {
    expect(
      rule.evaluate(elastiCacheCluster({ utilization: elastiCacheMetrics({ engineCpuMax: 60 }) }), ctx())
        .outcome,
    ).toBe('NOT_DETECTED');
    const memory = elastiCacheCluster({ utilization: elastiCacheMetrics({ memMax: 50 }) });
    expect(rule.evaluate(memory, ctx()).outcome).toBe('NOT_DETECTED');
    expect(rule.evaluate(memory, ctx({ maxMemoryPercent: 60 })).outcome).toBe('DETECTED');
  });

  it('reports a null target for the smallest size of a family and Valkey pricing', () => {
    const out = rule.evaluate(
      elastiCacheCluster({
        attributes: { engine: 'valkey', cacheNodeType: 'cache.r6g.large' },
        utilization: elastiCacheMetrics(),
      }),
      ctx(),
    );
    expect(out.outcome === 'DETECTED' && out.savingsRequest).toMatchObject({
      cacheEngine: 'Valkey',
      targetNodeType: null,
    });
  });

  it('handles lifecycle states and coverage', () => {
    expect(rule.evaluate(elastiCacheCluster({ state: 'modifying' }), ctx()).outcome).toBe('NOT_EVALUATED');
    expect(rule.evaluate(elastiCacheCluster({ state: 'deleting' }), ctx()).outcome).toBe('NOT_DETECTED');
    const out = rule.evaluate(
      elastiCacheCluster({ utilization: elastiCacheMetrics({ coverage: 0.5 }) }),
      ctx(),
    );
    expect(out.outcome === 'NOT_EVALUATED' && out.reason).toMatch(/^INSUFFICIENT_METRIC_COVERAGE/);
  });
});
