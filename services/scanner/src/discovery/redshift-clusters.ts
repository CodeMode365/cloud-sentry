import { paginateDescribeClusters, type Cluster, type RedshiftClient } from '@aws-sdk/client-redshift';
import type { DiscoveredResourceOf } from '@cloudsentry/shared-types';
import { orNull, tagsToRecord, toIso, type DiscoveryContext } from './common';

/** Redshift reports MultiAZ as "Enabled" / "Disabled". */
function multiAzFlag(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.toLowerCase();
  if (normalized === 'enabled') return true;
  if (normalized === 'disabled') return false;
  return null;
}

export function mapRedshiftCluster(
  cluster: Cluster,
  ctx: DiscoveryContext,
): DiscoveredResourceOf<'REDSHIFT_CLUSTER'> | null {
  const id = cluster.ClusterIdentifier;
  if (!id) return null;
  const status = cluster.ClusterStatus ?? 'unknown';
  return {
    resourceType: 'REDSHIFT_CLUSTER',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: id,
    arn: `arn:aws:redshift:${ctx.region}:${ctx.accountId}:cluster:${id}`,
    name: id,
    state: status,
    tags: tagsToRecord(cluster.Tags),
    createdAt: toIso(cluster.ClusterCreateTime),
    attributes: {
      clusterIdentifier: id,
      nodeType: cluster.NodeType ?? 'unknown',
      numberOfNodes: cluster.NumberOfNodes ?? 1,
      clusterStatus: status,
      availabilityStatus: orNull(cluster.ClusterAvailabilityStatus),
      encrypted: cluster.Encrypted ?? false,
      multiAz: multiAzFlag(cluster.MultiAZ),
      automatedSnapshotRetentionPeriod: orNull(cluster.AutomatedSnapshotRetentionPeriod),
    },
  };
}

/** Provisioned Redshift clusters (Redshift Serverless workgroups are not covered). */
export async function discoverRedshiftClusters(
  client: RedshiftClient,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'REDSHIFT_CLUSTER'>[]> {
  const out: DiscoveredResourceOf<'REDSHIFT_CLUSTER'>[] = [];
  for await (const page of paginateDescribeClusters({ client, pageSize: 100 }, {})) {
    for (const cluster of page.Clusters ?? []) {
      const mapped = mapRedshiftCluster(cluster, ctx);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}
