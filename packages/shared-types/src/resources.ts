import type { ResourceType } from './enums';
import type { ResourceUtilization } from './metrics';

/** Fields common to every discovered AWS resource, independent of resource type. */
export interface ResourceBase {
  /** 12-digit AWS account ID that owns the resource. */
  accountId: string;
  region: string;
  /** Native AWS identifier (instance ID, volume ID, allocation ID, DB identifier, ARN for ELBs). */
  resourceId: string;
  arn: string | null;
  /** Value of the `Name` tag or the native name where AWS provides one. */
  name: string | null;
  /** Native AWS state string (e.g. running, available, in-use). */
  state: string;
  tags: Record<string, string>;
  /** Creation / launch timestamp reported by AWS (ISO-8601), when available. */
  createdAt: string | null;
}

export interface Ec2InstanceAttributes {
  instanceType: string;
  availabilityZone: string | null;
  launchTime: string | null;
  /** Value of PlatformDetails, e.g. "Linux/UNIX", "Windows", "Red Hat Enterprise Linux". */
  platformDetails: string | null;
  platform: string | null;
  /** "default" | "dedicated" | "host" */
  tenancy: string;
  /** "spot" | "scheduled" | "capacity-block" | null (on-demand) */
  instanceLifecycle: string | null;
  publicIpAddress: string | null;
  privateIpAddress: string | null;
  monitoringState: string | null;
  vpcId: string | null;
  subnetId: string | null;
  architecture: string | null;
  attachedVolumeIds: string[];
}

export interface EbsVolumeAttributes {
  volumeType: string;
  sizeGiB: number;
  iops: number | null;
  throughput: number | null;
  availabilityZone: string | null;
  encrypted: boolean;
  snapshotId: string | null;
  attachments: {
    instanceId: string | null;
    device: string | null;
    state: string | null;
    attachTime: string | null;
  }[];
  multiAttachEnabled: boolean;
}

export interface ElasticIpAttributes {
  allocationId: string;
  publicIp: string | null;
  associationId: string | null;
  instanceId: string | null;
  networkInterfaceId: string | null;
  privateIpAddress: string | null;
  domain: string | null;
}

export interface RdsInstanceAttributes {
  dbInstanceIdentifier: string;
  engine: string;
  engineVersion: string | null;
  instanceClass: string;
  allocatedStorageGiB: number;
  storageType: string | null;
  availabilityZone: string | null;
  multiAz: boolean;
  publiclyAccessible: boolean;
  storageEncrypted: boolean;
  licenseModel: string | null;
  dbClusterIdentifier: string | null;
}

export interface EbsSnapshotAttributes {
  snapshotId: string;
  volumeId: string | null;
  volumeSizeGiB: number;
  description: string | null;
  ownerId: string | null;
  ownerAlias: string | null;
  progress: string | null;
  storageTier: string | null;
  encrypted: boolean;
  /** True when the source volume still exists in the latest discovery (filled during normalization). */
  sourceVolumeExists: boolean | null;
}

export interface NatGatewayAttributes {
  natGatewayId: string;
  subnetId: string | null;
  vpcId: string | null;
  connectivityType: string | null;
  publicIps: string[];
}

export interface LoadBalancerAttributes {
  loadBalancerArn: string;
  loadBalancerName: string;
  /** "application" | "network" | "gateway" */
  type: string;
  scheme: string | null;
  vpcId: string | null;
  availabilityZones: string[];
  dnsName: string | null;
}

export interface ResourceAttributesByType {
  EC2_INSTANCE: Ec2InstanceAttributes;
  EBS_VOLUME: EbsVolumeAttributes;
  ELASTIC_IP: ElasticIpAttributes;
  RDS_INSTANCE: RdsInstanceAttributes;
  EBS_SNAPSHOT: EbsSnapshotAttributes;
  NAT_GATEWAY: NatGatewayAttributes;
  LOAD_BALANCER: LoadBalancerAttributes;
  LAMBDA_FUNCTION: LambdaFunctionAttributes;
  EKS_CLUSTER: EksClusterAttributes;
  ELASTICACHE_CLUSTER: ElastiCacheClusterAttributes;
  CLOUDFRONT_DISTRIBUTION: CloudFrontDistributionAttributes;
  EFS_FILE_SYSTEM: EfsFileSystemAttributes;
  DYNAMODB_TABLE: DynamoDbTableAttributes;
  REDSHIFT_CLUSTER: RedshiftClusterAttributes;
  BACKUP_PLAN: BackupPlanAttributes;
  BACKUP_VAULT: BackupVaultAttributes;
}

/** A resource as returned by a discovery worker, before persistence. */
export type DiscoveredResource = {
  [K in ResourceType]: ResourceBase & { resourceType: K; attributes: ResourceAttributesByType[K] };
}[ResourceType];

export type DiscoveredResourceOf<K extends ResourceType> = Extract<DiscoveredResource, { resourceType: K }>;

/** A discovered resource enriched with utilization data; the input of the detection engine. */
export type NormalizedResource = DiscoveredResource & {
  /** Stable CloudSentry key: base64url(accountId|region|resourceType|resourceId). */
  resourceKey: string;
  utilization: ResourceUtilization | null;
};

export const RESOURCE_LIFECYCLE_STATUSES = ['ACTIVE', 'NOT_FOUND'] as const;
export type ResourceLifecycleStatus = (typeof RESOURCE_LIFECYCLE_STATUSES)[number];

/** Persisted resource inventory record. */
export type CloudResource = NormalizedResource & {
  tenantId: string;
  lifecycleStatus: ResourceLifecycleStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSeenScanId: string;
  /** Number of findings currently OPEN or ACKNOWLEDGED for this resource. */
  activeFindingCount: number;
  updatedAt: string;
  version: number;
};

// ---------------------------------------------------------------- Extended services

export interface LambdaFunctionAttributes {
  functionName: string;
  runtime: string | null;
  /** "x86_64" | "arm64" */
  architecture: string;
  memoryMb: number;
  timeoutSeconds: number;
  /** "Zip" | "Image" */
  packageType: string;
  ephemeralStorageMb: number | null;
  lastModified: string | null;
  /** Provisioned concurrency configurations (per alias or version). */
  provisionedConcurrency: { qualifier: string; allocated: number; requested: number; status: string | null }[];
}

export interface EksNodegroupSummary {
  name: string;
  status: string | null;
  instanceTypes: string[];
  /** "ON_DEMAND" | "SPOT" | "CAPACITY_BLOCK" */
  capacityType: string | null;
  /** e.g. AL2023_x86_64_STANDARD, BOTTLEROCKET_ARM_64, WINDOWS_CORE_2022_x86_64 */
  amiType: string | null;
  desiredSize: number;
  minSize: number;
  maxSize: number;
}

export interface EksClusterAttributes {
  clusterName: string;
  version: string | null;
  platformVersion: string | null;
  /** upgradePolicy.supportType: "STANDARD" | "EXTENDED" (policy, not proof of current extended-support billing). */
  supportType: string | null;
  /** EKS Auto Mode (computeConfig.enabled). */
  autoModeEnabled: boolean;
  nodegroups: EksNodegroupSummary[];
  fargateProfileCount: number;
}

export interface ElastiCacheClusterAttributes {
  cacheClusterId: string;
  /** "redis" | "valkey" | "memcached" */
  engine: string;
  engineVersion: string | null;
  cacheNodeType: string;
  numCacheNodes: number;
  replicationGroupId: string | null;
  preferredAvailabilityZone: string | null;
  snapshotRetentionLimit: number | null;
}

export interface CloudFrontDistributionAttributes {
  distributionId: string;
  domainName: string | null;
  enabled: boolean;
  /** PriceClass_All | PriceClass_200 | PriceClass_100 */
  priceClass: string | null;
  httpVersion: string | null;
  aliases: string[];
  /** DefaultCacheBehavior.Compress */
  defaultCacheBehaviorCompress: boolean | null;
  originCount: number;
  webAclId: string | null;
  lastModifiedTime: string | null;
}

export interface EfsFileSystemAttributes {
  fileSystemId: string;
  performanceMode: string | null;
  /** bursting | provisioned | elastic */
  throughputMode: string | null;
  provisionedThroughputMibps: number | null;
  sizeBytesTotal: number;
  sizeBytesStandard: number;
  sizeBytesInfrequentAccess: number;
  sizeBytesArchive: number;
  numberOfMountTargets: number;
  encrypted: boolean;
  /** One Zone file systems have an availability zone. */
  availabilityZoneName: string | null;
  /** null when DescribeLifecycleConfiguration failed (unknown), [] fields null when not configured. */
  lifecycle: { transitionToIA: string | null; transitionToArchive: string | null; transitionToPrimary: string | null } | null;
}

export interface DynamoDbTableAttributes {
  tableName: string;
  /** PROVISIONED | PAY_PER_REQUEST */
  billingMode: string;
  /** STANDARD | STANDARD_INFREQUENT_ACCESS */
  tableClass: string;
  provisionedReadCapacityUnits: number | null;
  provisionedWriteCapacityUnits: number | null;
  gsiCount: number;
  gsiProvisionedReadCapacityUnits: number;
  gsiProvisionedWriteCapacityUnits: number;
  tableSizeBytes: number;
  itemCount: number;
  /** Application Auto Scaling target registered for the table; null when it could not be determined. */
  autoScalingEnabled: boolean | null;
  deletionProtectionEnabled: boolean;
  /** Global table replica regions (other than this one). */
  replicaRegions: string[];
}

export interface RedshiftClusterAttributes {
  clusterIdentifier: string;
  nodeType: string;
  numberOfNodes: number;
  /** available | paused | ... */
  clusterStatus: string;
  availabilityStatus: string | null;
  encrypted: boolean;
  multiAz: boolean | null;
  automatedSnapshotRetentionPeriod: number | null;
}

export interface BackupPlanRuleSummary {
  ruleName: string;
  targetVaultName: string | null;
  scheduleExpression: string | null;
  /** null = recovery points are retained indefinitely. */
  deleteAfterDays: number | null;
  moveToColdStorageAfterDays: number | null;
  copyActionCount: number;
}

export interface BackupPlanAttributes {
  backupPlanId: string;
  backupPlanName: string;
  versionId: string | null;
  lastExecutionDate: string | null;
  rules: BackupPlanRuleSummary[];
}

/** Age bucket lower bounds (days) used for recovery point summaries. */
export const BACKUP_AGE_BUCKETS_DAYS = [0, 30, 90, 180, 365, 730] as const;

export interface BackupVaultResourceTypeSummary {
  /** AWS Backup resource type, e.g. EBS, EC2, RDS, EFS, DynamoDB. */
  resourceType: string;
  count: number;
  bytes: number;
  /** Non-cumulative buckets keyed by lower bound in days (BACKUP_AGE_BUCKETS_DAYS). */
  byAge: { minDays: number; count: number; bytes: number }[];
}

export interface BackupVaultAttributes {
  vaultName: string;
  locked: boolean;
  recoveryPointCount: number;
  totalBytes: number;
  /** True when recovery point listing stopped at the discovery cap; totals cover only listed points. */
  truncated: boolean;
  oldestRecoveryPointAt: string | null;
  byResourceType: BackupVaultResourceTypeSummary[];
  /** Resources with recovery points created by two or more backup plans in this vault (capped list). */
  resourcesWithMultiplePlans: { resourceArn: string; resourceType: string; planIds: string[] }[];
}
