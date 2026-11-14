import {
  DescribeLifecycleConfigurationCommand,
  paginateDescribeFileSystems,
  type EFSClient,
  type FileSystemDescription,
  type LifecyclePolicy,
} from '@aws-sdk/client-efs';
import type { DiscoveredResourceOf, EfsFileSystemAttributes } from '@cloudsentry/shared-types';
import { awsErrorName, errorMessage, mapSettledWithConcurrency } from '@cloudsentry/utilities';
import {
  loggerFor,
  nameFromTags,
  orNull,
  SUB_CALL_CONCURRENCY,
  tagsToRecord,
  toIso,
  type DiscoveryContext,
} from './common';

type Lifecycle = EfsFileSystemAttributes['lifecycle'];

/** Merges EFS lifecycle policies (each policy object carries one transition) into one record. */
export function mapLifecyclePolicies(policies: readonly LifecyclePolicy[] | undefined): NonNullable<Lifecycle> {
  const find = (pick: (p: LifecyclePolicy) => string | undefined): string | null =>
    policies?.map(pick).find((v): v is string => !!v) ?? null;
  return {
    transitionToIA: find((p) => p.TransitionToIA),
    transitionToArchive: find((p) => p.TransitionToArchive),
    transitionToPrimary: find((p) => p.TransitionToPrimaryStorageClass),
  };
}

export function mapEfsFileSystem(
  fs: FileSystemDescription,
  ctx: DiscoveryContext,
  lifecycle: Lifecycle,
): DiscoveredResourceOf<'EFS_FILE_SYSTEM'> | null {
  const id = fs.FileSystemId;
  if (!id) return null;
  const tags = tagsToRecord(fs.Tags);
  return {
    resourceType: 'EFS_FILE_SYSTEM',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: id,
    arn: fs.FileSystemArn ?? `arn:aws:elasticfilesystem:${ctx.region}:${ctx.accountId}:file-system/${id}`,
    name: fs.Name ? fs.Name : nameFromTags(tags),
    state: fs.LifeCycleState ?? 'unknown',
    tags,
    createdAt: toIso(fs.CreationTime),
    attributes: {
      fileSystemId: id,
      performanceMode: orNull(fs.PerformanceMode),
      throughputMode: orNull(fs.ThroughputMode),
      provisionedThroughputMibps: orNull(fs.ProvisionedThroughputInMibps),
      sizeBytesTotal: fs.SizeInBytes?.Value ?? 0,
      sizeBytesStandard: fs.SizeInBytes?.ValueInStandard ?? 0,
      sizeBytesInfrequentAccess: fs.SizeInBytes?.ValueInIA ?? 0,
      sizeBytesArchive: fs.SizeInBytes?.ValueInArchive ?? 0,
      numberOfMountTargets: fs.NumberOfMountTargets ?? 0,
      encrypted: fs.Encrypted ?? false,
      availabilityZoneName: orNull(fs.AvailabilityZoneName),
      lifecycle,
    },
  };
}

/**
 * EFS file systems (deleted ones excluded) with their lifecycle configuration. A failed
 * DescribeLifecycleConfiguration call leaves `lifecycle: null` (unknown) for that file system only.
 */
export async function discoverEfsFileSystems(
  client: EFSClient,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'EFS_FILE_SYSTEM'>[]> {
  const logger = loggerFor(ctx);
  const fileSystems: FileSystemDescription[] = [];
  for await (const page of paginateDescribeFileSystems({ client, pageSize: 100 }, {})) {
    for (const fs of page.FileSystems ?? []) {
      if (fs.FileSystemId && fs.LifeCycleState !== 'deleted') fileSystems.push(fs);
    }
  }

  const lifecycles = await mapSettledWithConcurrency(fileSystems, SUB_CALL_CONCURRENCY, async (fs) => {
    const out = await client.send(new DescribeLifecycleConfigurationCommand({ FileSystemId: fs.FileSystemId }));
    return mapLifecyclePolicies(out.LifecyclePolicies);
  });

  const out: DiscoveredResourceOf<'EFS_FILE_SYSTEM'>[] = [];
  for (const result of lifecycles) {
    let lifecycle: Lifecycle = null;
    if (result.status === 'fulfilled') lifecycle = result.value;
    else {
      logger.warn('DescribeLifecycleConfiguration failed; lifecycle unknown', {
        region: ctx.region,
        fileSystemId: result.item.FileSystemId,
        awsError: awsErrorName(result.reason),
        message: errorMessage(result.reason),
      });
    }
    const mapped = mapEfsFileSystem(result.item, ctx, lifecycle);
    if (mapped) out.push(mapped);
  }
  return out;
}
