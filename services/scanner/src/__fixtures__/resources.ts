/** SYNTHETIC TEST FIXTURE: discovered resources of the extended types, for metrics/normalize tests. Not real AWS data. */
import type { DiscoveredResourceOf } from '@cloudsentry/shared-types';

const accountId = '111122223333';

export function lambdaFunction(
  name = 'fixture-api',
  qualifiers: string[] = ['live', '7'],
  region = 'us-east-1',
): DiscoveredResourceOf<'LAMBDA_FUNCTION'> {
  const arn = `arn:aws:lambda:${region}:${accountId}:function:${name}`;
  return {
    resourceType: 'LAMBDA_FUNCTION',
    accountId,
    region,
    resourceId: arn,
    arn,
    name,
    state: 'Active',
    tags: {},
    createdAt: null,
    attributes: {
      functionName: name,
      runtime: 'nodejs20.x',
      architecture: 'x86_64',
      memoryMb: 1024,
      timeoutSeconds: 30,
      packageType: 'Zip',
      ephemeralStorageMb: 512,
      lastModified: null,
      provisionedConcurrency: qualifiers.map((qualifier) => ({
        qualifier,
        allocated: 10,
        requested: 10,
        status: 'READY',
      })),
    },
  };
}

export function cloudFrontDistribution(
  id = 'EDFDVBD6EXAMPLE1',
): DiscoveredResourceOf<'CLOUDFRONT_DISTRIBUTION'> {
  return {
    resourceType: 'CLOUDFRONT_DISTRIBUTION',
    accountId,
    region: 'global',
    resourceId: id,
    arn: `arn:aws:cloudfront::${accountId}:distribution/${id}`,
    name: 'cdn.example.invalid',
    state: 'Enabled',
    tags: {},
    createdAt: null,
    attributes: {
      distributionId: id,
      domainName: 'd111111abcdef8.cloudfront.net',
      enabled: true,
      priceClass: 'PriceClass_All',
      httpVersion: 'http2',
      aliases: ['cdn.example.invalid'],
      defaultCacheBehaviorCompress: false,
      originCount: 1,
      webAclId: null,
      lastModifiedTime: null,
    },
  };
}

export function eksCluster(state = 'ACTIVE'): DiscoveredResourceOf<'EKS_CLUSTER'> {
  return {
    resourceType: 'EKS_CLUSTER',
    accountId,
    region: 'us-east-1',
    resourceId: 'fixture-prod',
    arn: null,
    name: 'fixture-prod',
    state,
    tags: {},
    createdAt: null,
    attributes: {
      clusterName: 'fixture-prod',
      version: '1.31',
      platformVersion: null,
      supportType: 'STANDARD',
      autoModeEnabled: false,
      nodegroups: [],
      fargateProfileCount: 0,
    },
  };
}

export function elastiCacheCluster(state = 'available'): DiscoveredResourceOf<'ELASTICACHE_CLUSTER'> {
  return {
    resourceType: 'ELASTICACHE_CLUSTER',
    accountId,
    region: 'us-east-1',
    resourceId: 'fixture-redis-001',
    arn: null,
    name: 'fixture-redis-001',
    state,
    tags: {},
    createdAt: null,
    attributes: {
      cacheClusterId: 'fixture-redis-001',
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: 'cache.r6g.large',
      numCacheNodes: 1,
      replicationGroupId: null,
      preferredAvailabilityZone: null,
      snapshotRetentionLimit: null,
    },
  };
}

export function efsFileSystem(state = 'available'): DiscoveredResourceOf<'EFS_FILE_SYSTEM'> {
  return {
    resourceType: 'EFS_FILE_SYSTEM',
    accountId,
    region: 'us-east-1',
    resourceId: 'fs-0aaaaaaaaaaaaaaa1',
    arn: null,
    name: null,
    state,
    tags: {},
    createdAt: null,
    attributes: {
      fileSystemId: 'fs-0aaaaaaaaaaaaaaa1',
      performanceMode: 'generalPurpose',
      throughputMode: 'bursting',
      provisionedThroughputMibps: null,
      sizeBytesTotal: 0,
      sizeBytesStandard: 0,
      sizeBytesInfrequentAccess: 0,
      sizeBytesArchive: 0,
      numberOfMountTargets: 1,
      encrypted: true,
      availabilityZoneName: null,
      lifecycle: null,
    },
  };
}

export function dynamoDbTable(state = 'ACTIVE'): DiscoveredResourceOf<'DYNAMODB_TABLE'> {
  return {
    resourceType: 'DYNAMODB_TABLE',
    accountId,
    region: 'us-east-1',
    resourceId: 'orders',
    arn: null,
    name: 'orders',
    state,
    tags: {},
    createdAt: null,
    attributes: {
      tableName: 'orders',
      billingMode: 'PROVISIONED',
      tableClass: 'STANDARD',
      provisionedReadCapacityUnits: 100,
      provisionedWriteCapacityUnits: 50,
      gsiCount: 0,
      gsiProvisionedReadCapacityUnits: 0,
      gsiProvisionedWriteCapacityUnits: 0,
      tableSizeBytes: 0,
      itemCount: 0,
      autoScalingEnabled: false,
      deletionProtectionEnabled: false,
      replicaRegions: [],
    },
  };
}

export function redshiftCluster(state = 'available'): DiscoveredResourceOf<'REDSHIFT_CLUSTER'> {
  return {
    resourceType: 'REDSHIFT_CLUSTER',
    accountId,
    region: 'us-east-1',
    resourceId: 'fixture-warehouse',
    arn: null,
    name: 'fixture-warehouse',
    state,
    tags: {},
    createdAt: null,
    attributes: {
      clusterIdentifier: 'fixture-warehouse',
      nodeType: 'ra3.xlplus',
      numberOfNodes: 2,
      clusterStatus: state,
      availabilityStatus: null,
      encrypted: true,
      multiAz: false,
      automatedSnapshotRetentionPeriod: 1,
    },
  };
}

export function backupVault(): DiscoveredResourceOf<'BACKUP_VAULT'> {
  return {
    resourceType: 'BACKUP_VAULT',
    accountId,
    region: 'us-east-1',
    resourceId: 'fixture-vault',
    arn: null,
    name: 'fixture-vault',
    state: 'active',
    tags: {},
    createdAt: null,
    attributes: {
      vaultName: 'fixture-vault',
      locked: false,
      recoveryPointCount: 0,
      totalBytes: 0,
      truncated: false,
      oldestRecoveryPointAt: null,
      byResourceType: [],
      resourcesWithMultiplePlans: [],
    },
  };
}
