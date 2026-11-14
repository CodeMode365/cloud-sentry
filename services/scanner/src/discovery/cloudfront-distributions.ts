import {
  paginateListDistributions,
  type CloudFrontClient,
  type DistributionSummary,
} from '@aws-sdk/client-cloudfront';
import { GLOBAL_REGION, type DiscoveredResourceOf } from '@cloudsentry/shared-types';
import { orNull, toIso, type DiscoveryContext } from './common';

/**
 * CloudFront is global: distributions are listed once per scan (us-east-1 endpoint) and always carry
 * region `global`, whatever region the context names. CloudFront reports no creation time and tags
 * are not collected.
 */
export function mapCloudFrontDistribution(
  summary: DistributionSummary,
  ctx: DiscoveryContext,
): DiscoveredResourceOf<'CLOUDFRONT_DISTRIBUTION'> | null {
  const id = summary.Id;
  if (!id) return null;
  const aliases = (summary.Aliases?.Items ?? []).filter((a) => a !== '');
  const enabled = summary.Enabled ?? false;
  return {
    resourceType: 'CLOUDFRONT_DISTRIBUTION',
    accountId: ctx.accountId,
    region: GLOBAL_REGION,
    resourceId: id,
    arn: summary.ARN ?? `arn:aws:cloudfront::${ctx.accountId}:distribution/${id}`,
    name: aliases[0] ?? summary.DomainName ?? id,
    state: enabled ? 'Enabled' : 'Disabled',
    tags: {},
    createdAt: null,
    attributes: {
      distributionId: id,
      domainName: orNull(summary.DomainName),
      enabled,
      priceClass: orNull(summary.PriceClass),
      httpVersion: orNull(summary.HttpVersion),
      aliases,
      defaultCacheBehaviorCompress: orNull(summary.DefaultCacheBehavior?.Compress),
      originCount: summary.Origins?.Quantity ?? summary.Origins?.Items?.length ?? 0,
      webAclId: summary.WebACLId ? summary.WebACLId : null,
      lastModifiedTime: toIso(summary.LastModifiedTime),
    },
  };
}

export async function discoverCloudFrontDistributions(
  client: CloudFrontClient,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'CLOUDFRONT_DISTRIBUTION'>[]> {
  const out: DiscoveredResourceOf<'CLOUDFRONT_DISTRIBUTION'>[] = [];
  for await (const page of paginateListDistributions({ client, pageSize: 100 }, {})) {
    for (const summary of page.DistributionList?.Items ?? []) {
      const mapped = mapCloudFrontDistribution(summary, ctx);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}
