import { describe, expect, it } from 'vitest';
import type { DiscoveredResource, ResourceUtilization } from '@cloudsentry/shared-types';
import { resourceKeyFor } from '@cloudsentry/utilities';
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

function util(
  collectedAt: string,
  lookbackDays = 30,
  availability: 'AVAILABLE' | 'ERROR' = 'AVAILABLE',
): ResourceUtilization {
  return {
    lookbackDays,
    periodStart: '2026-10-15T12:00:00Z',
    periodEnd: '2026-11-14T12:00:00Z',
    collectedAt,
    observableDays: 30,
    metrics: {
      'VolumeReadOps:Sum': {
        namespace: 'AWS/EBS',
        metricName: 'VolumeReadOps',
        statistic: 'Sum',
        periodSeconds: 3600,
        unit: 'Count',
        availability,
        stats: null,
      },
    },
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
});
