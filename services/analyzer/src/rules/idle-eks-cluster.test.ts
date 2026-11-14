import { describe, expect, it } from 'vitest';
import type { EksNodegroupSummary } from '@cloudsentry/shared-types';
import { ctxFor } from '../__fixtures__/context';
import { daysAgo, eksCluster, eksMetrics } from '../__fixtures__/resources';
import { idleEksClusterRule as rule } from './idle-eks-cluster';

const ctx = (o = {}) => ctxFor(rule.defaultThresholds, o);
const ng = (o: Partial<EksNodegroupSummary> = {}): EksNodegroupSummary => ({
  name: 'ng-general',
  status: 'ACTIVE',
  instanceTypes: ['m6i.xlarge'],
  capacityType: 'ON_DEMAND',
  amiType: 'AL2023_x86_64_STANDARD',
  desiredSize: 0,
  minSize: 0,
  maxSize: 3,
  ...o,
});
const empty = (o: Parameters<typeof eksCluster>[0] = {}) =>
  eksCluster({ ...o, attributes: { nodegroups: [ng()], ...(o.attributes ?? {}) } });

describe('idle-eks-cluster', () => {
  it('flags an ACTIVE cluster with no managed capacity (control plane savings at the standard rate)', () => {
    const out = rule.evaluate(empty(), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect([out.confidence, out.riskLevel]).toEqual(['MEDIUM', 'HIGH']);
    expect(out.suggestedAction.type).toBe('DELETE_CLUSTER');
    expect(out.savingsRequest).toEqual({
      kind: 'EKS_CLUSTER_DELETE',
      region: 'us-east-1',
      supportType: 'STANDARD',
    });
    expect(out.evidence.some((e) => e.key === 'nodes.selfManaged')).toBe(true);
  });

  it('prices EXTENDED upgrade policies at the standard rate and says why', () => {
    const out = rule.evaluate(empty({ attributes: { supportType: 'EXTENDED' } }), ctx());
    expect(out.outcome === 'DETECTED' && out.savingsRequest).toMatchObject({ supportType: 'STANDARD' });
    expect(out.outcome === 'DETECTED' && out.evidence.some((e) => e.key === 'pricing.extendedSupport')).toBe(
      true,
    );
  });

  it.each([
    [{ nodegroups: [ng({ desiredSize: 2 })] }],
    [{ fargateProfileCount: 1 }],
    [{ autoModeEnabled: true }],
  ])('is NOT_DETECTED when the cluster has compute %j', (attributes) => {
    expect(rule.evaluate(empty({ attributes }), ctx()).outcome).toBe('NOT_DETECTED');
  });

  it('is NOT_DETECTED when Container Insights sees nodes outside managed node groups', () => {
    expect(rule.evaluate(empty({ utilization: eksMetrics({ nodeCount: 3 }) }), ctx()).outcome).toBe(
      'NOT_DETECTED',
    );
    expect(rule.evaluate(empty({ utilization: eksMetrics({ nodeCount: 0 }) }), ctx()).outcome).toBe(
      'DETECTED',
    );
  });

  it('applies the age gate (with overrides) and falls back to the observed period when createdAt is null', () => {
    const young = empty({ createdAt: daysAgo(3) });
    expect(rule.evaluate(young, ctx()).outcome).toBe('NOT_DETECTED');
    expect(rule.evaluate(young, ctx({ minAgeDays: 1 })).outcome).toBe('DETECTED');
    expect(rule.evaluate(empty({ createdAt: null }), ctx())).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'CREATION_TIME_UNKNOWN',
    });
    const observed = rule.evaluate(
      empty({ createdAt: null, utilization: eksMetrics({ nodeCount: null }) }),
      ctx(),
    );
    expect(observed.outcome).toBe('DETECTED');
    expect(
      observed.outcome === 'DETECTED' && observed.evidence.find((e) => e.key === 'cluster.ageDays')?.label,
    ).toMatch(/creation time unknown/);
  });

  it('does not read discovery placeholders as real zeros', () => {
    const unknown = rule.evaluate(empty({ state: 'unknown' }), ctx());
    expect(unknown.outcome === 'NOT_EVALUATED' && unknown.reason).toMatch(/^CLUSTER_DETAILS_UNAVAILABLE/);
    const failedGroup = rule.evaluate(
      empty({ attributes: { nodegroups: [ng({ name: 'ng-broken', status: null, desiredSize: 0 })] } }),
      ctx(),
    );
    expect(failedGroup).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'NODEGROUP_DETAILS_UNAVAILABLE: ng-broken',
    });
  });

  it('handles lifecycle states', () => {
    expect(rule.evaluate(empty({ state: 'CREATING' }), ctx())).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'TRANSIENT_STATE: CREATING',
    });
    expect(rule.evaluate(empty({ state: 'DELETING' }), ctx()).outcome).toBe('NOT_DETECTED');
  });
});
