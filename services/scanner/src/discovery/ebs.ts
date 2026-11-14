import { paginateDescribeVolumes, type EC2Client, type Volume } from '@aws-sdk/client-ec2';
import type { DiscoveredResourceOf } from '@cloudsentry/shared-types';
import { nameFromTags, orNull, tagsToRecord, toIso, type DiscoveryContext } from './common';

export function mapEbsVolume(
  volume: Volume,
  ctx: DiscoveryContext,
): DiscoveredResourceOf<'EBS_VOLUME'> | null {
  const volumeId = volume.VolumeId;
  if (!volumeId) return null;
  const tags = tagsToRecord(volume.Tags);
  return {
    resourceType: 'EBS_VOLUME',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: volumeId,
    arn: `arn:aws:ec2:${ctx.region}:${ctx.accountId}:volume/${volumeId}`,
    name: nameFromTags(tags),
    state: volume.State ?? 'unknown',
    tags,
    createdAt: toIso(volume.CreateTime),
    attributes: {
      volumeType: volume.VolumeType ?? 'unknown',
      sizeGiB: volume.Size ?? 0,
      iops: orNull(volume.Iops),
      throughput: orNull(volume.Throughput),
      availabilityZone: orNull(volume.AvailabilityZone),
      encrypted: volume.Encrypted ?? false,
      snapshotId: volume.SnapshotId ? volume.SnapshotId : null,
      attachments: (volume.Attachments ?? []).map((a) => ({
        instanceId: orNull(a.InstanceId),
        device: orNull(a.Device),
        state: orNull(a.State),
        attachTime: toIso(a.AttachTime),
      })),
      multiAttachEnabled: volume.MultiAttachEnabled ?? false,
    },
  };
}

export async function discoverEbsVolumes(
  client: EC2Client,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'EBS_VOLUME'>[]> {
  const out: DiscoveredResourceOf<'EBS_VOLUME'>[] = [];
  for await (const page of paginateDescribeVolumes({ client, pageSize: 500 }, {})) {
    for (const volume of page.Volumes ?? []) {
      const mapped = mapEbsVolume(volume, ctx);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}
