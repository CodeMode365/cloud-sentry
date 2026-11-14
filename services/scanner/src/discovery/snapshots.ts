import { paginateDescribeSnapshots, type EC2Client, type Snapshot } from '@aws-sdk/client-ec2';
import type { DiscoveredResourceOf } from '@cloudsentry/shared-types';
import { nameFromTags, orNull, tagsToRecord, toIso, type DiscoveryContext } from './common';

/** AWS uses this placeholder volume ID for snapshots copied from another region/account or created from AMIs. */
const PLACEHOLDER_VOLUME_ID = 'vol-ffffffff';

export function mapSnapshot(
  snapshot: Snapshot,
  ctx: DiscoveryContext,
): DiscoveredResourceOf<'EBS_SNAPSHOT'> | null {
  const snapshotId = snapshot.SnapshotId;
  if (!snapshotId) return null;
  const tags = tagsToRecord(snapshot.Tags);
  const volumeId =
    snapshot.VolumeId && snapshot.VolumeId !== PLACEHOLDER_VOLUME_ID ? snapshot.VolumeId : null;
  return {
    resourceType: 'EBS_SNAPSHOT',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: snapshotId,
    arn: `arn:aws:ec2:${ctx.region}::snapshot/${snapshotId}`,
    name: nameFromTags(tags),
    state: snapshot.State ?? 'unknown',
    tags,
    createdAt: toIso(snapshot.StartTime),
    attributes: {
      snapshotId,
      volumeId,
      volumeSizeGiB: snapshot.VolumeSize ?? 0,
      description: snapshot.Description ? snapshot.Description : null,
      ownerId: orNull(snapshot.OwnerId),
      ownerAlias: orNull(snapshot.OwnerAlias),
      progress: orNull(snapshot.Progress),
      storageTier: orNull(snapshot.StorageTier),
      encrypted: snapshot.Encrypted ?? false,
      // Filled in during normalization when EBS discovery for the region succeeded.
      sourceVolumeExists: null,
    },
  };
}

/** Only snapshots owned by the account (OwnerIds: self); public and shared snapshots are not billed to it. */
export async function discoverSnapshots(
  client: EC2Client,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'EBS_SNAPSHOT'>[]> {
  const out: DiscoveredResourceOf<'EBS_SNAPSHOT'>[] = [];
  for await (const page of paginateDescribeSnapshots({ client, pageSize: 1000 }, { OwnerIds: ['self'] })) {
    for (const snapshot of page.Snapshots ?? []) {
      const mapped = mapSnapshot(snapshot, ctx);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}
