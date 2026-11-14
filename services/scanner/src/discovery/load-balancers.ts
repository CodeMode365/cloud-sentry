import {
  paginateDescribeLoadBalancers,
  type ElasticLoadBalancingV2Client,
  type LoadBalancer,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import type { DiscoveredResourceOf } from '@cloudsentry/shared-types';
import { orNull, toIso, type DiscoveryContext } from './common';

/**
 * Application, Network and Gateway load balancers (ELBv2). Classic Load Balancers (ELB v1) are not
 * supported in the MVP. Tags require a separate DescribeTags call per 20 ARNs and are not collected yet.
 */
export function mapLoadBalancer(
  lb: LoadBalancer,
  ctx: DiscoveryContext,
): DiscoveredResourceOf<'LOAD_BALANCER'> | null {
  const arn = lb.LoadBalancerArn;
  if (!arn) return null;
  const name = lb.LoadBalancerName ?? arn.split('/').slice(-2, -1)[0] ?? arn;
  return {
    resourceType: 'LOAD_BALANCER',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: arn,
    arn,
    name,
    state: lb.State?.Code ?? 'unknown',
    tags: {},
    createdAt: toIso(lb.CreatedTime),
    attributes: {
      loadBalancerArn: arn,
      loadBalancerName: name,
      type: lb.Type ?? 'unknown',
      scheme: orNull(lb.Scheme),
      vpcId: orNull(lb.VpcId),
      availabilityZones: (lb.AvailabilityZones ?? [])
        .map((az) => az.ZoneName)
        .filter((z): z is string => !!z),
      dnsName: orNull(lb.DNSName),
    },
  };
}

export async function discoverLoadBalancers(
  client: ElasticLoadBalancingV2Client,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'LOAD_BALANCER'>[]> {
  const out: DiscoveredResourceOf<'LOAD_BALANCER'>[] = [];
  for await (const page of paginateDescribeLoadBalancers({ client, pageSize: 400 }, {})) {
    for (const lb of page.LoadBalancers ?? []) {
      const mapped = mapLoadBalancer(lb, ctx);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}
