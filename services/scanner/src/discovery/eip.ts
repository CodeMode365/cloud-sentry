import { DescribeAddressesCommand, type Address, type EC2Client } from '@aws-sdk/client-ec2';
import type { DiscoveredResourceOf } from '@cloudsentry/shared-types';
import { nameFromTags, orNull, tagsToRecord, type DiscoveryContext } from './common';

export function mapElasticIp(
  address: Address,
  ctx: DiscoveryContext,
): DiscoveredResourceOf<'ELASTIC_IP'> | null {
  const allocationId = address.AllocationId;
  // EC2-Classic addresses have no allocation ID; they no longer exist on AWS and are ignored.
  if (!allocationId) return null;
  const tags = tagsToRecord(address.Tags);
  return {
    resourceType: 'ELASTIC_IP',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: allocationId,
    arn: `arn:aws:ec2:${ctx.region}:${ctx.accountId}:elastic-ip/${allocationId}`,
    name: nameFromTags(tags),
    state: address.AssociationId ? 'associated' : 'unassociated',
    tags,
    // DescribeAddresses does not report an allocation timestamp.
    createdAt: null,
    attributes: {
      allocationId,
      publicIp: orNull(address.PublicIp),
      associationId: orNull(address.AssociationId),
      instanceId: address.InstanceId ? address.InstanceId : null,
      networkInterfaceId: orNull(address.NetworkInterfaceId),
      privateIpAddress: orNull(address.PrivateIpAddress),
      domain: orNull(address.Domain),
    },
  };
}

/** DescribeAddresses is not paginated by AWS; one call returns every address in the region. */
export async function discoverElasticIps(
  client: EC2Client,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'ELASTIC_IP'>[]> {
  const out = await client.send(new DescribeAddressesCommand({}));
  return (out.Addresses ?? [])
    .map((a) => mapElasticIp(a, ctx))
    .filter((r): r is DiscoveredResourceOf<'ELASTIC_IP'> => r !== null);
}
