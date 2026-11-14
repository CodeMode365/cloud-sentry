import { paginateDescribeNatGateways, type EC2Client, type NatGateway } from '@aws-sdk/client-ec2';
import type { DiscoveredResourceOf } from '@cloudsentry/shared-types';
import { nameFromTags, orNull, tagsToRecord, toIso, type DiscoveryContext } from './common';

const EXCLUDED_STATES = new Set(['deleted', 'deleting']);

export function mapNatGateway(
  gateway: NatGateway,
  ctx: DiscoveryContext,
): DiscoveredResourceOf<'NAT_GATEWAY'> | null {
  const id = gateway.NatGatewayId;
  if (!id) return null;
  const tags = tagsToRecord(gateway.Tags);
  return {
    resourceType: 'NAT_GATEWAY',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: id,
    arn: `arn:aws:ec2:${ctx.region}:${ctx.accountId}:natgateway/${id}`,
    name: nameFromTags(tags),
    state: gateway.State ?? 'unknown',
    tags,
    createdAt: toIso(gateway.CreateTime),
    attributes: {
      natGatewayId: id,
      subnetId: orNull(gateway.SubnetId),
      vpcId: orNull(gateway.VpcId),
      connectivityType: orNull(gateway.ConnectivityType),
      publicIps: (gateway.NatGatewayAddresses ?? [])
        .map((a) => a.PublicIp)
        .filter((ip): ip is string => !!ip),
    },
  };
}

export async function discoverNatGateways(
  client: EC2Client,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'NAT_GATEWAY'>[]> {
  const out: DiscoveredResourceOf<'NAT_GATEWAY'>[] = [];
  for await (const page of paginateDescribeNatGateways({ client, pageSize: 1000 }, {})) {
    for (const gateway of page.NatGateways ?? []) {
      if (EXCLUDED_STATES.has(gateway.State ?? '')) continue;
      const mapped = mapNatGateway(gateway, ctx);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}
