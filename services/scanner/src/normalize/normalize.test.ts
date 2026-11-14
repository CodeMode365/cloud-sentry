import { describe, expect, it } from 'vitest';
import type { DiscoveredResource, ResourceUtilization } from '@cloudsentry/shared-types';
import { resourceKeyFor } from '@cloudsentry/utilities';
import { normalizeResources } from './normalize';

const account = '111122223333';

function volume(region: string, id: string): DiscoveredResource {
  return {
    resourceType: 'EBS_VOLUME',
    accountId: account,
    region,
    resourceId: id,
    arn: null,
    name: null,
    state: 'in-use',
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

function snapshot(region: string, id: string, volumeId: string | null): DiscoveredResource {
  return {
    resourceType: 'EBS_SNAPSHOT',
    accountId: account,
    region,
    resourceId: id,
    arn: null,
    name: null,
    state: 'completed',
    tags: {},
    createdAt: null,
    attributes: {
      snapshotId: id,
      volumeId,
      volumeSizeGiB: 10,
      description: null,
      ownerId: account,
      ownerAlias: null,
      progress: null,
      storageTier: null,
      encrypted: false,
      sourceVolumeExists: null,
    },
  };
}

describe('normalizeResources', () => {
  it('attaches utilization, resolves snapshot source volumes only for successful EBS regions, dedupes and sorts', () => {
    const vol = volume('us-east-1', 'vol-1');
    const util: ResourceUtilization = {
      lookbackDays: 30,
      periodStart: '2026-10-15T00:00:00Z',
      periodEnd: '2026-11-14T00:00:00Z',
      collectedAt: '2026-11-14T00:00:00Z',
      observableDays: 30,
      metrics: {},
    };
    const volKey = resourceKeyFor(account, 'us-east-1', 'EBS_VOLUME', 'vol-1');
    const discovered = [
      snapshot('us-east-1', 'snap-a', 'vol-1'),
      snapshot('us-east-1', 'snap-b', 'vol-gone'),
      snapshot('us-east-1', 'snap-c', null),
      snapshot('eu-west-1', 'snap-d', 'vol-unknown'),
      vol,
      vol,
    ];

    const result = normalizeResources(discovered, new Map([[volKey, util]]), {
      succeededRegionsByType: { EBS_VOLUME: ['us-east-1'], EBS_SNAPSHOT: ['us-east-1', 'eu-west-1'] },
    });

    expect(result).toHaveLength(5);
    const keys = result.map((r) => r.resourceKey);
    expect(keys).toEqual([...keys].sort());
    const byId = new Map(result.map((r) => [r.resourceId, r]));
    expect(byId.get('vol-1')?.utilization).toBe(util);
    expect(byId.get('vol-1')?.resourceKey).toBe(volKey);
    const exists = (id: string) => {
      const r = byId.get(id);
      return r?.resourceType === 'EBS_SNAPSHOT' ? r.attributes.sourceVolumeExists : undefined;
    };
    expect(exists('snap-a')).toBe(true);
    expect(exists('snap-b')).toBe(false);
    expect(exists('snap-c')).toBe(false);
    expect(exists('snap-d')).toBeNull();
    expect(byId.get('snap-a')?.utilization).toBeNull();
  });
});
