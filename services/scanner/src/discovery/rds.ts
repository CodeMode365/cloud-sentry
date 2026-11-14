import { paginateDescribeDBInstances, type DBInstance, type RDSClient } from '@aws-sdk/client-rds';
import type { DiscoveredResourceOf } from '@cloudsentry/shared-types';
import { nameFromTags, orNull, tagsToRecord, toIso, type DiscoveryContext } from './common';

export function mapRdsInstance(
  db: DBInstance,
  ctx: DiscoveryContext,
): DiscoveredResourceOf<'RDS_INSTANCE'> | null {
  const id = db.DBInstanceIdentifier;
  if (!id) return null;
  const tags = tagsToRecord(db.TagList);
  return {
    resourceType: 'RDS_INSTANCE',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: id,
    arn: db.DBInstanceArn ?? `arn:aws:rds:${ctx.region}:${ctx.accountId}:db:${id}`,
    name: nameFromTags(tags) ?? id,
    state: db.DBInstanceStatus ?? 'unknown',
    tags,
    createdAt: toIso(db.InstanceCreateTime),
    attributes: {
      dbInstanceIdentifier: id,
      engine: db.Engine ?? 'unknown',
      engineVersion: orNull(db.EngineVersion),
      instanceClass: db.DBInstanceClass ?? 'unknown',
      allocatedStorageGiB: db.AllocatedStorage ?? 0,
      storageType: orNull(db.StorageType),
      availabilityZone: orNull(db.AvailabilityZone),
      multiAz: db.MultiAZ ?? false,
      publiclyAccessible: db.PubliclyAccessible ?? false,
      storageEncrypted: db.StorageEncrypted ?? false,
      licenseModel: orNull(db.LicenseModel),
      dbClusterIdentifier: orNull(db.DBClusterIdentifier),
    },
  };
}

export async function discoverRdsInstances(
  client: RDSClient,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'RDS_INSTANCE'>[]> {
  const out: DiscoveredResourceOf<'RDS_INSTANCE'>[] = [];
  for await (const page of paginateDescribeDBInstances({ client, pageSize: 100 }, {})) {
    for (const db of page.DBInstances ?? []) {
      const mapped = mapRdsInstance(db, ctx);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}
