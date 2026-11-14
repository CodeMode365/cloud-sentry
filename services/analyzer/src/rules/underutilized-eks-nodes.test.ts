import { describe, expect, it } from 'vitest';
import type { EksNodegroupSummary } from '@cloudsentry/shared-types';
import { ctxFor } from '../__fixtures__/context';
import { eksCluster, eksMetrics } from '../__fixtures__/resources';
import { underutilizedEksNodesRule as rule } from './underutilized-eks-nodes';

const ctx = (o = {}) => ctxFor(rule.defaultThresholds, o);
const ng = (o: Partial<EksNodegroupSummary>): EksNodegroupSummary => ({
  name: 'ng',
  status: 'ACTIVE',
  instanceTypes: ['m6i.xlarge'],
  capacityType: 'ON_DEMAND',
  amiType: 'AL2023_x86_64_STANDARD',
  desiredSize: 3,
  minSize: 1,
  maxSize: 10,
  ...o,
});

describe('underutilized-eks-nodes', () => {
  it('computes required = max(1, ceil(nodes x max(cpuP95, memP95) / 70)) and prices the removable nodes', () => {
    // 6 nodes, CPU p95 20%, memory p95 30% -> ceil(6 x 30 / 70) = 3 required, 3 removable
    const out = rule.evaluate(eksCluster({ utilization: eksMetrics() }), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.suggestedAction.type).toBe('REDUCE_NODE_COUNT');
    expect(out.savingsRequest).toEqual({
      kind: 'EKS_NODES_REDUCE',
      region: 'us-east-1',
      instanceType: 'm6i.xlarge',
      operatingSystem: 'Linux',
      capacityType: 'ON_DEMAND',
      removableNodes: 3,
    });
    expect(out.evidence.find((e) => e.key === 'nodes.required')?.value).toBe(3);
    expect(out.confidence).toBe('MEDIUM');
  });

  it('requires Container Insights', () => {
    const out = rule.evaluate(eksCluster({ utilization: eksMetrics({ containerInsights: false }) }), ctx());
    expect(out.outcome === 'NOT_EVALUATED' && out.reason).toMatch(
      /^CONTAINER_INSIGHTS_NOT_ENABLED: METRIC_NO_DATA: node_cpu_utilization:Average/,
    );
    expect(rule.evaluate(eksCluster(), ctx())).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRICS_NOT_COLLECTED',
    });
  });

  it('does not flag busy clusters unless thresholds are raised', () => {
    const busyCpu = eksCluster({ utilization: eksMetrics({ cpuP95: 35 }) });
    expect(rule.evaluate(busyCpu, ctx()).outcome).toBe('NOT_DETECTED');
    expect(rule.evaluate(busyCpu, ctx({ maxCpuPercent: 40 })).outcome).toBe('DETECTED');
    expect(rule.evaluate(eksCluster({ utilization: eksMetrics({ memP95: 45 }) }), ctx()).outcome).toBe(
      'NOT_DETECTED',
    );
  });

  it('is NOT_DETECTED for single-node clusters or when no node can be removed', () => {
    const one = eksCluster({
      attributes: { nodegroups: [ng({ desiredSize: 1 })] },
      utilization: eksMetrics(),
    });
    expect(rule.evaluate(one, ctx()).outcome).toBe('NOT_DETECTED');
    const two = eksCluster({
      attributes: { nodegroups: [ng({ desiredSize: 2 })] },
      utilization: eksMetrics({ cpuP95: 29, memP95: 39 }),
    });
    expect(rule.evaluate(two, ctx()).outcome).toBe('NOT_DETECTED');
  });

  it('prices the largest node group and maps Windows, Spot and mixed instance types', () => {
    const r = (nodegroups: EksNodegroupSummary[]) =>
      rule.evaluate(eksCluster({ attributes: { nodegroups }, utilization: eksMetrics() }), ctx());
    expect(
      r([
        ng({ name: 'a', desiredSize: 2, instanceTypes: ['m5.large'] }),
        ng({ name: 'b', desiredSize: 4, instanceTypes: ['c6i.2xlarge'] }),
      ]),
    ).toMatchObject({
      savingsRequest: { instanceType: 'c6i.2xlarge' },
    });
    expect(r([ng({ desiredSize: 6, amiType: 'WINDOWS_CORE_2022_x86_64' })])).toMatchObject({
      savingsRequest: { operatingSystem: 'Windows' },
    });
    expect(r([ng({ desiredSize: 6, capacityType: 'SPOT' })])).toMatchObject({
      savingsRequest: { capacityType: 'SPOT' },
    });
    const mixed = r([ng({ desiredSize: 6, instanceTypes: ['m5.large', 'm5a.large'] })]);
    expect(mixed.outcome === 'DETECTED' && mixed.savingsRequest).toBeNull();
    expect(mixed.outcome === 'DETECTED' && mixed.evidence.some((e) => e.key === 'pricing.unsupported')).toBe(
      true,
    );
  });

  it('lowers confidence when Container Insights sees nodes outside managed node groups', () => {
    const out = rule.evaluate(eksCluster({ utilization: eksMetrics({ nodeCount: 9 }) }), ctx());
    expect(out.outcome === 'DETECTED' && out.confidence).toBe('LOW');
  });

  it('does not evaluate Auto Mode, placeholders, low coverage or short observation', () => {
    const out = (o: Parameters<typeof eksCluster>[0]) =>
      rule.evaluate(eksCluster({ utilization: eksMetrics(), ...o }), ctx());
    expect(out({ attributes: { autoModeEnabled: true } })).toMatchObject({
      reason: expect.stringMatching(/^AUTO_MODE_ENABLED/),
    });
    expect(out({ state: 'unknown' })).toMatchObject({
      reason: expect.stringMatching(/^CLUSTER_DETAILS_UNAVAILABLE/),
    });
    expect(
      out({
        attributes: { nodegroups: [ng({ desiredSize: 6 }), ng({ name: 'x', status: null, desiredSize: 0 })] },
      }),
    ).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'NODEGROUP_DETAILS_UNAVAILABLE: x',
    });
    expect(out({ utilization: eksMetrics({ coverage: 0.5 }) })).toMatchObject({
      reason: expect.stringMatching(/^INSUFFICIENT_METRIC_COVERAGE/),
    });
    expect(out({ utilization: eksMetrics({ observableDays: 7 }) })).toMatchObject({
      reason: expect.stringMatching(/^INSUFFICIENT_OBSERVATION_PERIOD/),
    });
  });
});
