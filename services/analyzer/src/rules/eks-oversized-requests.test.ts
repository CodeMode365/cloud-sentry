import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { eksCluster, eksMetrics, series, utilizationOf } from '../__fixtures__/resources';
import { eksOversizedRequestsRule as rule } from './eks-oversized-requests';

const ctx = (o = {}) => ctxFor(rule.defaultThresholds, o);

describe('eks-oversized-requests', () => {
  it('flags clusters whose CPU requests reserve far more than is used, without savings', () => {
    const out = rule.evaluate(
      eksCluster({ utilization: eksMetrics({ cpuReserved: 80, cpuAvg: 12 }) }),
      ctx(),
    );
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.suggestedAction.type).toBe('RIGHTSIZE_POD_REQUESTS');
    expect(out.confidence).toBe('MEDIUM');
    expect(out.savingsRequest).toBeNull();
    expect(out.evidence.find((e) => e.key === 'cpu.reservedAverage')).toMatchObject({
      value: 80,
      threshold: '>= 70',
    });
  });

  it('flags the memory side on its own', () => {
    const out = rule.evaluate(
      eksCluster({ utilization: eksMetrics({ memReserved: 85, memAvg: 20 }) }),
      ctx(),
    );
    expect(out.outcome).toBe('DETECTED');
  });

  it('is NOT_DETECTED when requests are close to usage, and honours overrides', () => {
    const r = eksCluster({ utilization: eksMetrics() }); // 40% / 45% reserved
    expect(rule.evaluate(r, ctx()).outcome).toBe('NOT_DETECTED');
    expect(rule.evaluate(r, ctx({ minReservedPercent: 35 })).outcome).toBe('DETECTED');
  });

  it('requires Container Insights and never concludes NOT_DETECTED from one missing side', () => {
    const off = rule.evaluate(eksCluster({ utilization: eksMetrics({ containerInsights: false }) }), ctx());
    expect(off.outcome === 'NOT_EVALUATED' && off.reason).toMatch(/^CONTAINER_INSIGHTS_NOT_ENABLED/);
    const cpuOnly = (reserved: number) =>
      utilizationOf([
        series('ContainerInsights', 'node_cpu_reserved_capacity', 'Average', { average: reserved }),
        series('ContainerInsights', 'node_cpu_utilization', 'Average', { average: 10 }),
        series('ContainerInsights', 'node_memory_reserved_capacity', 'Average', { availability: 'NO_DATA' }),
        series('ContainerInsights', 'node_memory_utilization', 'Average', { availability: 'NO_DATA' }),
      ]);
    expect(rule.evaluate(eksCluster({ utilization: cpuOnly(30) }), ctx()).outcome).toBe('NOT_EVALUATED');
    const detected = rule.evaluate(eksCluster({ utilization: cpuOnly(90) }), ctx());
    expect(detected.outcome).toBe('DETECTED');
    expect(
      detected.outcome === 'DETECTED' && detected.evidence.some((e) => e.key === 'memory.notEvaluated'),
    ).toBe(true);
  });

  it('does not evaluate discovery placeholders', () => {
    expect(
      rule.evaluate(eksCluster({ state: 'unknown', utilization: eksMetrics({ cpuReserved: 90 }) }), ctx())
        .outcome,
    ).toBe('NOT_EVALUATED');
  });
});
