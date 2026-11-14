import { paginateDescribeInstances, type EC2Client, type Instance } from '@aws-sdk/client-ec2';
import type { DiscoveredResourceOf } from '@cloudsentry/shared-types';
import { nameFromTags, orNull, tagsToRecord, toIso, type DiscoveryContext } from './common';

/** Instances in these states are gone or going and are not reported. */
const EXCLUDED_STATES = new Set(['terminated', 'shutting-down']);

export function mapEc2Instance(
  instance: Instance,
  ctx: DiscoveryContext,
): DiscoveredResourceOf<'EC2_INSTANCE'> | null {
  const instanceId = instance.InstanceId;
  if (!instanceId) return null;
  const tags = tagsToRecord(instance.Tags);
  const launchTime = toIso(instance.LaunchTime);
  return {
    resourceType: 'EC2_INSTANCE',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: instanceId,
    arn: `arn:aws:ec2:${ctx.region}:${ctx.accountId}:instance/${instanceId}`,
    name: nameFromTags(tags),
    state: instance.State?.Name ?? 'unknown',
    tags,
    createdAt: launchTime,
    attributes: {
      instanceType: instance.InstanceType ?? 'unknown',
      availabilityZone: orNull(instance.Placement?.AvailabilityZone),
      launchTime,
      platformDetails: orNull(instance.PlatformDetails),
      platform: orNull(instance.Platform),
      tenancy: instance.Placement?.Tenancy ?? 'default',
      instanceLifecycle: orNull(instance.InstanceLifecycle),
      publicIpAddress: orNull(instance.PublicIpAddress),
      privateIpAddress: orNull(instance.PrivateIpAddress),
      monitoringState: orNull(instance.Monitoring?.State),
      vpcId: orNull(instance.VpcId),
      subnetId: orNull(instance.SubnetId),
      architecture: orNull(instance.Architecture),
      attachedVolumeIds: (instance.BlockDeviceMappings ?? [])
        .map((m) => m.Ebs?.VolumeId)
        .filter((id): id is string => !!id),
    },
  };
}

export async function discoverEc2Instances(
  client: EC2Client,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'EC2_INSTANCE'>[]> {
  const out: DiscoveredResourceOf<'EC2_INSTANCE'>[] = [];
  for await (const page of paginateDescribeInstances({ client, pageSize: 1000 }, {})) {
    for (const reservation of page.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        if (EXCLUDED_STATES.has(instance.State?.Name ?? '')) continue;
        const mapped = mapEc2Instance(instance, ctx);
        if (mapped) out.push(mapped);
      }
    }
  }
  return out;
}
