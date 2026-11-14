import {
  paginateDescribeCacheClusters,
  type CacheCluster,
  type ElastiCacheClient,
} from '@aws-sdk/client-elasticache';
import type { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import type { DiscoveredResourceOf } from '@cloudsentry/shared-types';
import { loggerFor, orNull, toIso, type DiscoveryContext } from './common';
import { fetchTagsByArn } from './tagging';

export function mapElastiCacheCluster(
  cluster: CacheCluster,
  ctx: DiscoveryContext,
  tagsByArn: ReadonlyMap<string, Record<string, string>>,
): DiscoveredResourceOf<'ELASTICACHE_CLUSTER'> | null {
  const id = cluster.CacheClusterId;
  if (!id) return null;
  const arn = cluster.ARN ?? `arn:aws:elasticache:${ctx.region}:${ctx.accountId}:cluster:${id}`;
  return {
    resourceType: 'ELASTICACHE_CLUSTER',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: id,
    arn,
    name: id,
    state: cluster.CacheClusterStatus ?? 'unknown',
    tags: tagsByArn.get(arn) ?? {},
    createdAt: toIso(cluster.CacheClusterCreateTime),
    attributes: {
      cacheClusterId: id,
      engine: cluster.Engine ?? 'unknown',
      engineVersion: orNull(cluster.EngineVersion),
      cacheNodeType: cluster.CacheNodeType ?? 'unknown',
      numCacheNodes: cluster.NumCacheNodes ?? 0,
      replicationGroupId: orNull(cluster.ReplicationGroupId),
      preferredAvailabilityZone: orNull(cluster.PreferredAvailabilityZone),
      snapshotRetentionLimit: orNull(cluster.SnapshotRetentionLimit),
    },
  };
}

/**
 * Node-based ElastiCache clusters (Redis OSS, Valkey, Memcached), including replication group members.
 * ElastiCache Serverless caches are not covered. Tags come from the Tagging API (`elasticache:cluster`).
 */
export async function discoverElastiCacheClusters(
  client: ElastiCacheClient,
  tagging: ResourceGroupsTaggingAPIClient,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'ELASTICACHE_CLUSTER'>[]> {
  const tagsPromise = fetchTagsByArn(tagging, ['elasticache:cluster'], loggerFor(ctx));
  const clusters: CacheCluster[] = [];
  for await (const page of paginateDescribeCacheClusters({ client, pageSize: 100 }, {})) {
    clusters.push(...(page.CacheClusters ?? []));
  }
  const tagsByArn = await tagsPromise;
  const out: DiscoveredResourceOf<'ELASTICACHE_CLUSTER'>[] = [];
  for (const cluster of clusters) {
    const mapped = mapElastiCacheCluster(cluster, ctx, tagsByArn);
    if (mapped) out.push(mapped);
  }
  return out;
}
