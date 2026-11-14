import {
  DescribeClusterCommand,
  DescribeNodegroupCommand,
  paginateListClusters,
  paginateListFargateProfiles,
  paginateListNodegroups,
  type Cluster,
  type EKSClient,
  type Nodegroup,
} from '@aws-sdk/client-eks';
import type { DiscoveredResourceOf, EksNodegroupSummary } from '@cloudsentry/shared-types';
import { awsErrorName, errorMessage, mapSettledWithConcurrency } from '@cloudsentry/utilities';
import {
  isNotFoundError,
  loggerFor,
  orNull,
  SUB_CALL_CONCURRENCY,
  toIso,
  type DiscoveryContext,
} from './common';

/** State reported when a cluster's details could not be read completely; no metrics or rules apply. */
export const EKS_UNKNOWN_STATE = 'unknown';

export function mapNodegroup(nodegroup: Nodegroup, fallbackName: string): EksNodegroupSummary {
  return {
    name: nodegroup.nodegroupName ?? fallbackName,
    status: orNull(nodegroup.status),
    instanceTypes: nodegroup.instanceTypes ?? [],
    capacityType: orNull(nodegroup.capacityType),
    amiType: orNull(nodegroup.amiType),
    desiredSize: nodegroup.scalingConfig?.desiredSize ?? 0,
    minSize: nodegroup.scalingConfig?.minSize ?? 0,
    maxSize: nodegroup.scalingConfig?.maxSize ?? 0,
  };
}

/**
 * Placeholder for a nodegroup whose DescribeNodegroup call failed: `status: null` and zero sizes mean
 * "unknown", and the owning cluster is reported with state `unknown` so no rule acts on the zeros.
 */
export function unknownNodegroup(name: string): EksNodegroupSummary {
  return {
    name,
    status: null,
    instanceTypes: [],
    capacityType: null,
    amiType: null,
    desiredSize: 0,
    minSize: 0,
    maxSize: 0,
  };
}

export function mapEksCluster(
  clusterName: string,
  cluster: Cluster | null,
  nodegroups: EksNodegroupSummary[],
  fargateProfileCount: number,
  ctx: DiscoveryContext,
  complete: boolean,
): DiscoveredResourceOf<'EKS_CLUSTER'> {
  return {
    resourceType: 'EKS_CLUSTER',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: clusterName,
    arn: cluster?.arn ?? `arn:aws:eks:${ctx.region}:${ctx.accountId}:cluster/${clusterName}`,
    name: clusterName,
    state: complete ? (cluster?.status ?? EKS_UNKNOWN_STATE) : EKS_UNKNOWN_STATE,
    tags: { ...(cluster?.tags ?? {}) },
    createdAt: toIso(cluster?.createdAt),
    attributes: {
      clusterName,
      version: orNull(cluster?.version),
      platformVersion: orNull(cluster?.platformVersion),
      supportType: orNull(cluster?.upgradePolicy?.supportType),
      autoModeEnabled: cluster?.computeConfig?.enabled ?? false,
      nodegroups,
      fargateProfileCount,
    },
  };
}

interface ClusterDetails {
  clusterName: string;
  cluster: Cluster | null;
  nodegroupNames: string[];
  fargateProfileCount: number;
  /** False when DescribeCluster, ListNodegroups or ListFargateProfiles failed. */
  complete: boolean;
}

async function settle<T>(fn: () => Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: 'fulfilled', value: await fn() };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

async function listAll<T>(pages: AsyncIterable<T>, pick: (page: T) => readonly string[] | undefined) {
  const out: string[] = [];
  for await (const page of pages) out.push(...(pick(page) ?? []));
  return out;
}

/**
 * EKS clusters with their managed nodegroups and Fargate profile count. Per-cluster calls run with
 * bounded concurrency. A cluster deleted mid-scan (ResourceNotFound) is skipped; any other per-cluster
 * failure keeps the cluster in the inventory with state `unknown` (partial details) instead of failing
 * the region.
 */
export async function discoverEksClusters(
  client: EKSClient,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'EKS_CLUSTER'>[]> {
  const logger = loggerFor(ctx);
  const clusterNames = await listAll(paginateListClusters({ client, pageSize: 100 }, {}), (p) => p.clusters);

  const detailResults = await mapSettledWithConcurrency(
    [...new Set(clusterNames)],
    SUB_CALL_CONCURRENCY,
    async (clusterName): Promise<ClusterDetails | null> => {
      // Sequential per cluster so at most SUB_CALL_CONCURRENCY EKS calls are in flight.
      const described = await settle(() => client.send(new DescribeClusterCommand({ name: clusterName })));
      const nodegroups = await settle(() =>
        listAll(paginateListNodegroups({ client, pageSize: 100 }, { clusterName }), (p) => p.nodegroups),
      );
      const fargate = await settle(() =>
        listAll(
          paginateListFargateProfiles({ client, pageSize: 100 }, { clusterName }),
          (p) => p.fargateProfileNames,
        ),
      );
      const failures = [described, nodegroups, fargate].filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      if (failures.some((f) => isNotFoundError(f.reason))) return null;
      for (const f of failures) {
        logger.warn('EKS cluster detail call failed; cluster reported with state unknown', {
          region: ctx.region,
          clusterName,
          awsError: awsErrorName(f.reason),
          message: errorMessage(f.reason),
        });
      }
      return {
        clusterName,
        cluster: described.status === 'fulfilled' ? (described.value.cluster ?? null) : null,
        nodegroupNames: nodegroups.status === 'fulfilled' ? nodegroups.value : [],
        fargateProfileCount: fargate.status === 'fulfilled' ? fargate.value.length : 0,
        complete: failures.length === 0,
      };
    },
  );

  const clusters: ClusterDetails[] = [];
  for (const result of detailResults) {
    if (result.status === 'fulfilled') {
      if (result.value) clusters.push(result.value);
    } else {
      // Not expected (failures are settled above); keep the cluster rather than lose it.
      clusters.push({
        clusterName: result.item,
        cluster: null,
        nodegroupNames: [],
        fargateProfileCount: 0,
        complete: false,
      });
    }
  }

  const nodegroupRefs = clusters.flatMap((c) =>
    c.nodegroupNames.map((nodegroupName) => ({ clusterName: c.clusterName, nodegroupName })),
  );
  const nodegroupResults = await mapSettledWithConcurrency(nodegroupRefs, SUB_CALL_CONCURRENCY, (ref) =>
    client.send(new DescribeNodegroupCommand(ref)),
  );

  const nodegroupsByCluster = new Map<string, EksNodegroupSummary[]>();
  const degraded = new Set<string>();
  for (const result of nodegroupResults) {
    const { clusterName, nodegroupName } = result.item;
    const list = nodegroupsByCluster.get(clusterName) ?? [];
    if (result.status === 'fulfilled') {
      if (result.value.nodegroup) list.push(mapNodegroup(result.value.nodegroup, nodegroupName));
    } else if (!isNotFoundError(result.reason)) {
      logger.warn('DescribeNodegroup failed; nodegroup details unknown', {
        region: ctx.region,
        clusterName,
        nodegroupName,
        awsError: awsErrorName(result.reason),
        message: errorMessage(result.reason),
      });
      list.push(unknownNodegroup(nodegroupName));
      degraded.add(clusterName);
    }
    nodegroupsByCluster.set(clusterName, list);
  }

  return clusters.map((c) =>
    mapEksCluster(
      c.clusterName,
      c.cluster,
      nodegroupsByCluster.get(c.clusterName) ?? [],
      c.fargateProfileCount,
      ctx,
      c.complete && !degraded.has(c.clusterName),
    ),
  );
}
