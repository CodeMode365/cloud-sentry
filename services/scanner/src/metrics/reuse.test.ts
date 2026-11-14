import { describe, expect, it } from 'vitest';
import type { DiscoveredResource, MetricSeriesSummary, ResourceUtilization } from '@cloudsentry/shared-types';
import { resourceKeyFor } from '@cloudsentry/utilities';
import { cloudFrontDistribution, lambdaFunction } from '../__fixtures__/resources';
import { metricQueriesFor } from './catalog';
import { partitionForReuse } from './reuse';

const NOW = new Date('2026-11-14T12:00:00Z');

function volume(id: string, state: string): DiscoveredResource {
  return {
    resourceType: 'EBS_VOLUME',
    accountId: '111122223333',
    region: 'us-east-1',
    resourceId: id,
    arn: null,
    name: null,
    state,
    tags: {},
    createdAt: null,
    attributes: {
      volumeType: 'gp3',
      sizeGiB: 10,
      iops: null,
      throughput: null,
      availabilityZone: null,
      encrypted: false,
      snapshotId: null,
      attachments: [],
      multiAttachEnabled: false,
    },
  };
}

/** Utilization holding every key the catalog plans for `resource` (an in-use EBS volume by default). */
function util(
  collectedAt: string,
  lookbackDays = 30,
  availability: 'AVAILABLE' | 'ERROR' = 'AVAILABLE',
  resource: DiscoveredResource = volume('vol-template', 'in-use'),
): ResourceUtilization {
  const metrics: Record<string, MetricSeriesSummary> = {};
  for (const q of metricQueriesFor(resource)) {
    metrics[q.key] = {
      namespace: q.namespace,
      metricName: q.metricName,
      statistic: q.stat,
      periodSeconds: 3600,
      unit: q.unit,
      availability,
      stats: null,
    };
  }
  return {
    lookbackDays,
    periodStart: '2026-10-15T12:00:00Z',
    periodEnd: '2026-11-14T12:00:00Z',
    collectedAt,
    observableDays: 30,
    metrics,
  };
}

const key = (r: DiscoveredResource) => resourceKeyFor(r.accountId, r.region, r.resourceType, r.resourceId);

describe('partitionForReuse', () => {
  it('reuses fresh, error-free utilization with the same lookback and collects the rest', () => {
    const fresh = volume('vol-fresh', 'in-use');
    const stale = volume('vol-stale', 'in-use');
    const otherLookback = volume('vol-lookback', 'in-use');
    const errored = volume('vol-error', 'in-use');
    const missing = volume('vol-missing', 'in-use');
    const unattached = volume('vol-available', 'available');
    const previous = new Map<string, ResourceUtilization | null>([
      [key(fresh), util('2026-11-14T08:00:00Z')],
      [key(stale), util('2026-11-13T12:00:00Z')],
      [key(otherLookback), util('2026-11-14T08:00:00Z', 14)],
      [key(errored), util('2026-11-14T08:00:00Z', 30, 'ERROR')],
      [key(missing), null],
    ]);

    const { reuse, collect } = partitionForReuse(
      [fresh, stale, otherLookback, errored, missing, unattached],
      previous,
      {
        reuseHours: 6,
        lookbackDays: 30,
        now: NOW,
      },
    );

    expect([...reuse.keys()]).toEqual([key(fresh)]);
    expect(collect.map((r) => r.resourceId)).toEqual([
      'vol-stale',
      'vol-lookback',
      'vol-error',
      'vol-missing',
    ]);
  });

  it('never reuses when reuseHours is 0', () => {
    const fresh = volume('vol-fresh', 'in-use');
    const { reuse, collect } = partitionForReuse(
      [fresh],
      new Map([[key(fresh), util('2026-11-14T11:59:00Z')]]),
      {
        reuseHours: 0,
        lookbackDays: 30,
        now: NOW,
      },
    );
    expect(reuse.size).toBe(0);
    expect(collect).toHaveLength(1);
  });

  it('recollects when the catalog now plans keys the previous utilization lacks (new PC qualifier)', () => {
    const before = lambdaFunction('fixture-api', ['live']);
    const after = lambdaFunction('fixture-api', ['live', 'canary']);
    const cf = cloudFrontDistribution('E1');
    const previous = new Map<string, ResourceUtilization | null>([
      [key(before), util('2026-11-14T10:00:00Z', 30, 'AVAILABLE', before)],
      [key(cf), util('2026-11-14T10:00:00Z', 30, 'AVAILABLE', cf)],
    ]);
    const opts = { reuseHours: 6, lookbackDays: 30, now: NOW };

    const same = partitionForReuse([before, cf], previous, opts);
    expect([...same.reuse.keys()]).toEqual([key(before), key(cf)]);
    expect(same.collect).toEqual([]);

    const changed = partitionForReuse([after, cf], previous, opts);
    expect([...changed.reuse.keys()]).toEqual([key(cf)]);
    expect(changed.collect.map((r) => r.resourceId)).toEqual([after.resourceId]);
  });
});
