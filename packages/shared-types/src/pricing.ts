/**
 * Pricing and savings estimation contracts. Prices always come from an identified source
 * (the AWS Price List API) and every estimate carries its assumptions.
 */

export const HOURS_PER_MONTH = 730;
export const MONTHS_PER_YEAR = 12;

export type Currency = 'USD';

export type Ec2PricingQuery = {
  kind: 'EC2_INSTANCE_HOURLY';
  region: string;
  instanceType: string;
  /** Price List `operatingSystem` value, e.g. Linux, Windows, RHEL, SUSE. */
  operatingSystem: string;
  /** Price List `tenancy` value: Shared | Dedicated | Host. */
  tenancy: string;
  /** Price List `preInstalledSw` value, usually NA. */
  preInstalledSw: string;
  /** Price List `licenseModel` value. */
  licenseModel: string;
};
export type EbsStoragePricingQuery = { kind: 'EBS_STORAGE_GB_MONTH'; region: string; volumeApiName: string };
export type EbsSnapshotPricingQuery = { kind: 'EBS_SNAPSHOT_GB_MONTH'; region: string };
export type PublicIpv4PricingQuery = { kind: 'PUBLIC_IPV4_IDLE_HOURLY'; region: string };
export type RdsInstancePricingQuery = {
  kind: 'RDS_INSTANCE_HOURLY';
  region: string;
  instanceClass: string;
  /** Price List `databaseEngine` value, e.g. PostgreSQL, MySQL, MariaDB. */
  databaseEngine: string;
  /** Single-AZ | Multi-AZ */
  deploymentOption: string;
};
export type NatGatewayPricingQuery = { kind: 'NAT_GATEWAY_HOURLY'; region: string };

/** Lambda compute, first (highest-price) tier. architecture: x86_64 | arm64. Unit Lambda-GB-Second. */
export type LambdaGbSecondPricingQuery = { kind: 'LAMBDA_GB_SECOND'; region: string; architecture: string };
/** Lambda provisioned concurrency (idle allocation). Unit Lambda-GB-Second. */
export type LambdaProvisionedConcurrencyPricingQuery = {
  kind: 'LAMBDA_PROVISIONED_CONCURRENCY_GB_SECOND';
  region: string;
  architecture: string;
};
/** EKS control plane per cluster-hour. supportType EXTENDED adds the extended-support charge. */
export type EksClusterPricingQuery = { kind: 'EKS_CLUSTER_HOURLY'; region: string; supportType: 'STANDARD' | 'EXTENDED' };
/** ElastiCache node-hour. cacheEngine: Price List value Redis | Valkey | Memcached. */
export type ElastiCacheNodePricingQuery = {
  kind: 'ELASTICACHE_NODE_HOURLY';
  region: string;
  cacheNodeType: string;
  cacheEngine: string;
};
/** EFS storage GB-month. storageClass: Price List value, e.g. "General Purpose", "Infrequent Access". */
export type EfsStoragePricingQuery = { kind: 'EFS_STORAGE_GB_MONTH'; region: string; storageClass: string };
/** DynamoDB provisioned capacity unit-hour (paid tier, not the free tier). */
export type DynamoDbProvisionedPricingQuery = {
  kind: 'DYNAMODB_PROVISIONED_CAPACITY_HOURLY';
  region: string;
  capacity: 'READ' | 'WRITE';
  /** STANDARD | STANDARD_INFREQUENT_ACCESS */
  tableClass: string;
};
/** DynamoDB on-demand request unit (per single request unit). */
export type DynamoDbOnDemandPricingQuery = {
  kind: 'DYNAMODB_ON_DEMAND_REQUEST_UNIT';
  region: string;
  request: 'READ' | 'WRITE';
  tableClass: string;
};
/** DynamoDB table storage GB-month (paid tier). */
export type DynamoDbStoragePricingQuery = { kind: 'DYNAMODB_STORAGE_GB_MONTH'; region: string; tableClass: string };
/** Redshift provisioned node-hour. */
export type RedshiftNodePricingQuery = { kind: 'REDSHIFT_NODE_HOURLY'; region: string; nodeType: string };

export type PriceQuery =
  | Ec2PricingQuery
  | EbsStoragePricingQuery
  | EbsSnapshotPricingQuery
  | PublicIpv4PricingQuery
  | RdsInstancePricingQuery
  | NatGatewayPricingQuery
  | LambdaGbSecondPricingQuery
  | LambdaProvisionedConcurrencyPricingQuery
  | EksClusterPricingQuery
  | ElastiCacheNodePricingQuery
  | EfsStoragePricingQuery
  | DynamoDbProvisionedPricingQuery
  | DynamoDbOnDemandPricingQuery
  | DynamoDbStoragePricingQuery
  | RedshiftNodePricingQuery;

export interface PricePoint {
  unitPriceUsd: number;
  /** Price List unit, e.g. Hrs, GB-Mo. */
  unit: string;
  sku: string | null;
  description: string | null;
  effectiveDate: string | null;
  source: 'AWS_PRICE_LIST_API';
  retrievedAt: string;
}

export interface PriceLookupResult {
  query: PriceQuery;
  price: PricePoint | null;
  /** Present when price is null. */
  unavailableReason?: string;
}

/** Cache for price lookups (implemented in @cloudsentry/database). */
export interface PriceCache {
  get(cacheKey: string): Promise<PriceLookupResult | null>;
  put(cacheKey: string, value: PriceLookupResult, ttlSeconds: number): Promise<void>;
}

/** Describes what action savings are being estimated for. Produced by detection rules. */
export type SavingsRequest =
  | {
      kind: 'EC2_INSTANCE_STOP';
      region: string;
      instanceType: string;
      operatingSystem: string;
      tenancy: string;
      preInstalledSw: string;
      licenseModel: string;
      /** Non-null when the instance is not on-demand (spot, capacity block); savings cannot be priced. */
      nonOnDemandLifecycle: string | null;
    }
  | {
      kind: 'EBS_VOLUME_DELETE';
      region: string;
      volumeType: string;
      sizeGiB: number;
    }
  | { kind: 'ELASTIC_IP_RELEASE'; region: string }
  | {
      kind: 'RDS_RIGHTSIZE';
      region: string;
      databaseEngine: string | null;
      currentClass: string;
      targetClass: string | null;
      multiAz: boolean;
    }
  | {
      kind: 'RDS_STOP';
      region: string;
      databaseEngine: string | null;
      instanceClass: string;
      multiAz: boolean;
    }
  | { kind: 'EBS_SNAPSHOT_DELETE'; region: string; sizeGiB: number }
  | { kind: 'NAT_GATEWAY_DELETE'; region: string }
  // ---- Lambda
  | {
      kind: 'LAMBDA_MEMORY_RIGHTSIZE';
      region: string;
      architecture: string;
      currentMemoryMb: number;
      recommendedMemoryMb: number;
      /** Observed billed duration normalised to 30 days (seconds). */
      monthlyDurationSeconds: number;
    }
  | { kind: 'LAMBDA_ARM64_MIGRATION'; region: string; memoryMb: number; monthlyDurationSeconds: number }
  | {
      kind: 'LAMBDA_PROVISIONED_CONCURRENCY_REDUCE';
      region: string;
      architecture: string;
      memoryMb: number;
      currentAllocated: number;
      recommendedAllocated: number;
    }
  // ---- EKS
  | { kind: 'EKS_CLUSTER_DELETE'; region: string; supportType: 'STANDARD' | 'EXTENDED' }
  | {
      kind: 'EKS_NODES_REDUCE';
      region: string;
      instanceType: string;
      /** Price List operatingSystem for the node AMI (Linux | Windows). */
      operatingSystem: string;
      capacityType: string | null;
      removableNodes: number;
    }
  // ---- ElastiCache
  | {
      kind: 'ELASTICACHE_RIGHTSIZE';
      region: string;
      cacheEngine: string;
      currentNodeType: string;
      targetNodeType: string | null;
      numNodes: number;
    }
  | { kind: 'ELASTICACHE_DELETE'; region: string; cacheEngine: string; cacheNodeType: string; numNodes: number }
  // ---- EFS
  | { kind: 'EFS_DELETE'; region: string; standardGb: number; infrequentAccessGb: number; archiveGb: number; oneZone: boolean }
  | { kind: 'EFS_LIFECYCLE_TO_IA'; region: string; standardGb: number; oneZone: boolean }
  // ---- DynamoDB
  | {
      kind: 'DYNAMODB_RIGHTSIZE_PROVISIONED';
      region: string;
      tableClass: string;
      currentRcu: number;
      currentWcu: number;
      recommendedRcu: number;
      recommendedWcu: number;
    }
  | {
      kind: 'DYNAMODB_SWITCH_TO_ON_DEMAND';
      region: string;
      tableClass: string;
      provisionedRcu: number;
      provisionedWcu: number;
      /** Consumed capacity units normalised to 30 days. */
      monthlyReadUnits: number;
      monthlyWriteUnits: number;
    }
  | {
      kind: 'DYNAMODB_DELETE_TABLE';
      region: string;
      tableClass: string;
      billingMode: string;
      provisionedRcu: number;
      provisionedWcu: number;
      storageGb: number;
    }
  // ---- Redshift
  | {
      kind: 'REDSHIFT_PAUSE';
      region: string;
      nodeType: string;
      numberOfNodes: number;
      /** Share of the month the cluster could be paused (1 = always idle). */
      pausableFraction: number;
    }
  // ---- AWS Backup (only EBS-based recovery points can be priced; see savings docs)
  | { kind: 'BACKUP_RETENTION_REDUCE'; region: string; ebsGbBeyondRetention: number; otherGbBeyondRetention: number };

export interface PricingSourceRef {
  query: PriceQuery;
  unitPriceUsd: number;
  unit: string;
  sku: string | null;
  effectiveDate: string | null;
  retrievedAt: string;
}

export interface SavingsEstimate {
  status: 'ESTIMATED' | 'UNAVAILABLE';
  /** POINT: best estimate. UPPER_BOUND: actual savings are likely lower (e.g. incremental snapshots). */
  estimateType: 'POINT' | 'UPPER_BOUND';
  monthly: number | null;
  annual: number | null;
  currency: Currency;
  /** Human-readable formula, e.g. "0.0104 USD/hr x 730 hr". */
  method: string;
  assumptions: string[];
  pricingSources: PricingSourceRef[];
  unavailableReason?: string;
  calculatedAt: string;
}
