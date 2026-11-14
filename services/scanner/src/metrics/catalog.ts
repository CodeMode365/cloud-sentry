import {
  GLOBAL_METRICS_REGION,
  metricKey,
  type DiscoveredResource,
  type MetricStatisticName,
  type ResourceType,
} from '@cloudsentry/shared-types';

export interface MetricDimension {
  name: string;
  value: string;
}

export interface MetricSpec {
  metricName: string;
  stat: MetricStatisticName;
  /** Display unit of the per-period value (CloudWatch does not return units from GetMetricData). */
  unit: string;
  /** Overrides the entry namespace (e.g. LambdaInsights metrics of a Lambda function). */
  namespace?: string;
  /** Overrides the entry dimensions (e.g. LambdaInsights `function_name`). */
  dimensions?: (resource: DiscoveredResource) => MetricDimension[];
}

/** One fully resolved CloudWatch query for one resource. */
export interface MetricQuery {
  /** Summary key in ResourceUtilization.metrics (default `${metricName}:${stat}`). */
  key: string;
  namespace: string;
  metricName: string;
  stat: MetricStatisticName;
  unit: string;
  dimensions: MetricDimension[];
  /** Multiplier applied to every datapoint before summarizing (e.g. 100 turns a 0..1 ratio into Percent). */
  scale?: number;
}

export interface MetricCatalogEntry {
  namespace: string;
  dimensionName: string;
  dimensionValue: (resource: DiscoveredResource) => string;
  /** Fixed dimensions added after the primary one (CloudFront: Region=Global). */
  extraDimensions?: MetricDimension[];
  /** Only resources in a state where utilization is meaningful are queried. */
  qualifies: (resource: DiscoveredResource) => boolean;
  metrics: MetricSpec[];
  /** Resource-specific queries with custom keys, e.g. one per Lambda provisioned concurrency qualifier. */
  dynamicQueries?: (resource: DiscoveredResource) => MetricQuery[];
  /** CloudWatch region that holds the metrics; defaults to the resource's region. */
  metricsRegion?: (resource: DiscoveredResource) => string;
}

/** Summary key of a Lambda provisioned concurrency config: `ProvisionedConcurrencyUtilization:Maximum:<qualifier>`. */
export function provisionedConcurrencyMetricKey(qualifier: string): string {
  return `${metricKey('ProvisionedConcurrencyUtilization', 'Maximum')}:${qualifier}`;
}

function lambdaFunctionName(r: DiscoveredResource): string {
  return r.resourceType === 'LAMBDA_FUNCTION' ? r.attributes.functionName : (r.name ?? r.resourceId);
}

function lambdaProvisionedConcurrencyQueries(r: DiscoveredResource): MetricQuery[] {
  if (r.resourceType !== 'LAMBDA_FUNCTION') return [];
  const functionName = r.attributes.functionName;
  return r.attributes.provisionedConcurrency.map((pc) => ({
    key: provisionedConcurrencyMetricKey(pc.qualifier),
    namespace: 'AWS/Lambda',
    metricName: 'ProvisionedConcurrencyUtilization',
    stat: 'Maximum',
    // CloudWatch reports the ratio executions / allocated (0..1); summaries are in percent like the rules.
    unit: 'Percent',
    scale: 100,
    dimensions: [
      { name: 'FunctionName', value: functionName },
      { name: 'Resource', value: `${functionName}:${pc.qualifier}` },
    ],
  }));
}

/**
 * Which CloudWatch metrics CloudSentry collects per resource type. Summary keys are
 * `${metricName}:${stat}` (see metricKey in shared-types) unless a dynamic query sets its own key
 * (Lambda provisioned concurrency: `ProvisionedConcurrencyUtilization:Maximum:<qualifier>`); the analyzer
 * depends on these exact keys. Elastic IPs, snapshots, load balancers and AWS Backup have no utilization
 * rules and are not queried.
 */
export const METRIC_CATALOG: Partial<Record<ResourceType, MetricCatalogEntry>> = {
  EC2_INSTANCE: {
    namespace: 'AWS/EC2',
    dimensionName: 'InstanceId',
    dimensionValue: (r) => r.resourceId,
    qualifies: (r) => r.resourceType === 'EC2_INSTANCE' && r.state === 'running',
    metrics: [
      { metricName: 'CPUUtilization', stat: 'Average', unit: 'Percent' },
      { metricName: 'CPUUtilization', stat: 'Maximum', unit: 'Percent' },
      { metricName: 'NetworkIn', stat: 'Sum', unit: 'Bytes' },
      { metricName: 'NetworkOut', stat: 'Sum', unit: 'Bytes' },
      // Only reported for instance-store volumes; EBS-backed instances usually return no data.
      { metricName: 'DiskReadOps', stat: 'Sum', unit: 'Count' },
      { metricName: 'DiskWriteOps', stat: 'Sum', unit: 'Count' },
      { metricName: 'StatusCheckFailed', stat: 'Maximum', unit: 'Count' },
    ],
  },
  EBS_VOLUME: {
    namespace: 'AWS/EBS',
    dimensionName: 'VolumeId',
    dimensionValue: (r) => r.resourceId,
    qualifies: (r) => r.resourceType === 'EBS_VOLUME' && r.state === 'in-use',
    metrics: [
      { metricName: 'VolumeReadOps', stat: 'Sum', unit: 'Count' },
      { metricName: 'VolumeWriteOps', stat: 'Sum', unit: 'Count' },
      { metricName: 'VolumeReadBytes', stat: 'Sum', unit: 'Bytes' },
      { metricName: 'VolumeWriteBytes', stat: 'Sum', unit: 'Bytes' },
      { metricName: 'VolumeIdleTime', stat: 'Sum', unit: 'Seconds' },
    ],
  },
  RDS_INSTANCE: {
    namespace: 'AWS/RDS',
    dimensionName: 'DBInstanceIdentifier',
    dimensionValue: (r) => r.resourceId,
    qualifies: (r) => r.resourceType === 'RDS_INSTANCE' && r.state === 'available',
    metrics: [
      { metricName: 'CPUUtilization', stat: 'Average', unit: 'Percent' },
      { metricName: 'CPUUtilization', stat: 'Maximum', unit: 'Percent' },
      { metricName: 'DatabaseConnections', stat: 'Average', unit: 'Count' },
      { metricName: 'DatabaseConnections', stat: 'Maximum', unit: 'Count' },
      { metricName: 'FreeableMemory', stat: 'Average', unit: 'Bytes' },
      { metricName: 'ReadIOPS', stat: 'Average', unit: 'Count/Second' },
      { metricName: 'WriteIOPS', stat: 'Average', unit: 'Count/Second' },
      { metricName: 'FreeStorageSpace', stat: 'Minimum', unit: 'Bytes' },
    ],
  },
  NAT_GATEWAY: {
    namespace: 'AWS/NATGateway',
    dimensionName: 'NatGatewayId',
    dimensionValue: (r) => r.resourceId,
    qualifies: (r) => r.resourceType === 'NAT_GATEWAY' && r.state === 'available',
    metrics: [
      { metricName: 'BytesOutToDestination', stat: 'Sum', unit: 'Bytes' },
      { metricName: 'BytesInFromDestination', stat: 'Sum', unit: 'Bytes' },
      { metricName: 'BytesInFromSource', stat: 'Sum', unit: 'Bytes' },
      { metricName: 'BytesOutToSource', stat: 'Sum', unit: 'Bytes' },
      { metricName: 'ActiveConnectionCount', stat: 'Maximum', unit: 'Count' },
    ],
  },
  LAMBDA_FUNCTION: {
    namespace: 'AWS/Lambda',
    dimensionName: 'FunctionName',
    dimensionValue: lambdaFunctionName,
    qualifies: (r) => r.resourceType === 'LAMBDA_FUNCTION',
    metrics: [
      { metricName: 'Invocations', stat: 'Sum', unit: 'Count' },
      { metricName: 'Duration', stat: 'Average', unit: 'Milliseconds' },
      { metricName: 'Duration', stat: 'Maximum', unit: 'Milliseconds' },
      { metricName: 'Duration', stat: 'Sum', unit: 'Milliseconds' },
      { metricName: 'Errors', stat: 'Sum', unit: 'Count' },
      { metricName: 'Throttles', stat: 'Sum', unit: 'Count' },
      // Lambda Insights (NO_DATA unless the extension is enabled on the function).
      ...(['memory_utilization', 'used_memory_max'] as const).map(
        (metricName): MetricSpec => ({
          metricName,
          stat: 'Maximum',
          unit: metricName === 'memory_utilization' ? 'Percent' : 'Megabytes',
          namespace: 'LambdaInsights',
          dimensions: (r) => [{ name: 'function_name', value: lambdaFunctionName(r) }],
        }),
      ),
    ],
    dynamicQueries: lambdaProvisionedConcurrencyQueries,
  },
  EKS_CLUSTER: {
    // Container Insights (NO_DATA unless enabled on the cluster).
    namespace: 'ContainerInsights',
    dimensionName: 'ClusterName',
    dimensionValue: (r) => r.resourceId,
    qualifies: (r) => r.resourceType === 'EKS_CLUSTER' && r.state === 'ACTIVE',
    metrics: [
      { metricName: 'node_cpu_utilization', stat: 'Average', unit: 'Percent' },
      { metricName: 'node_cpu_utilization', stat: 'Maximum', unit: 'Percent' },
      { metricName: 'node_memory_utilization', stat: 'Average', unit: 'Percent' },
      { metricName: 'node_memory_utilization', stat: 'Maximum', unit: 'Percent' },
      { metricName: 'node_cpu_reserved_capacity', stat: 'Average', unit: 'Percent' },
      { metricName: 'node_memory_reserved_capacity', stat: 'Average', unit: 'Percent' },
      { metricName: 'cluster_node_count', stat: 'Average', unit: 'Count' },
    ],
  },
  ELASTICACHE_CLUSTER: {
    namespace: 'AWS/ElastiCache',
    dimensionName: 'CacheClusterId',
    dimensionValue: (r) => r.resourceId,
    qualifies: (r) => r.resourceType === 'ELASTICACHE_CLUSTER' && r.state === 'available',
    metrics: [
      { metricName: 'CPUUtilization', stat: 'Average', unit: 'Percent' },
      { metricName: 'CPUUtilization', stat: 'Maximum', unit: 'Percent' },
      { metricName: 'EngineCPUUtilization', stat: 'Average', unit: 'Percent' },
      { metricName: 'EngineCPUUtilization', stat: 'Maximum', unit: 'Percent' },
      { metricName: 'DatabaseMemoryUsagePercentage', stat: 'Maximum', unit: 'Percent' },
      { metricName: 'CurrConnections', stat: 'Average', unit: 'Count' },
      { metricName: 'CurrConnections', stat: 'Maximum', unit: 'Count' },
      { metricName: 'NetworkBytesIn', stat: 'Sum', unit: 'Bytes' },
      { metricName: 'NetworkBytesOut', stat: 'Sum', unit: 'Bytes' },
    ],
  },
  CLOUDFRONT_DISTRIBUTION: {
    // CloudFront metrics exist only in us-east-1, with Region=Global, although resources use region "global".
    namespace: 'AWS/CloudFront',
    dimensionName: 'DistributionId',
    dimensionValue: (r) => r.resourceId,
    extraDimensions: [{ name: 'Region', value: 'Global' }],
    qualifies: (r) => r.resourceType === 'CLOUDFRONT_DISTRIBUTION',
    metricsRegion: () => GLOBAL_METRICS_REGION,
    metrics: [
      { metricName: 'Requests', stat: 'Sum', unit: 'Count' },
      { metricName: 'BytesDownloaded', stat: 'Sum', unit: 'Bytes' },
    ],
  },
  EFS_FILE_SYSTEM: {
    namespace: 'AWS/EFS',
    dimensionName: 'FileSystemId',
    dimensionValue: (r) => r.resourceId,
    qualifies: (r) => r.resourceType === 'EFS_FILE_SYSTEM' && r.state === 'available',
    metrics: [
      { metricName: 'ClientConnections', stat: 'Maximum', unit: 'Count' },
      { metricName: 'DataReadIOBytes', stat: 'Sum', unit: 'Bytes' },
      { metricName: 'DataWriteIOBytes', stat: 'Sum', unit: 'Bytes' },
      { metricName: 'MeteredIOBytes', stat: 'Sum', unit: 'Bytes' },
    ],
  },
  DYNAMODB_TABLE: {
    namespace: 'AWS/DynamoDB',
    dimensionName: 'TableName',
    dimensionValue: (r) => r.resourceId,
    qualifies: (r) => r.resourceType === 'DYNAMODB_TABLE' && r.state === 'ACTIVE',
    // Sum only: Maximum of ConsumedXCapacityUnits is the largest single request, not a rate.
    metrics: [
      { metricName: 'ConsumedReadCapacityUnits', stat: 'Sum', unit: 'Count' },
      { metricName: 'ConsumedWriteCapacityUnits', stat: 'Sum', unit: 'Count' },
      { metricName: 'ReadThrottleEvents', stat: 'Sum', unit: 'Count' },
      { metricName: 'WriteThrottleEvents', stat: 'Sum', unit: 'Count' },
    ],
  },
  REDSHIFT_CLUSTER: {
    namespace: 'AWS/Redshift',
    dimensionName: 'ClusterIdentifier',
    dimensionValue: (r) => r.resourceId,
    qualifies: (r) => r.resourceType === 'REDSHIFT_CLUSTER' && r.state === 'available',
    metrics: [
      { metricName: 'CPUUtilization', stat: 'Average', unit: 'Percent' },
      { metricName: 'CPUUtilization', stat: 'Maximum', unit: 'Percent' },
      { metricName: 'DatabaseConnections', stat: 'Average', unit: 'Count' },
      { metricName: 'DatabaseConnections', stat: 'Maximum', unit: 'Count' },
      { metricName: 'PercentageDiskSpaceUsed', stat: 'Average', unit: 'Percent' },
    ],
  },
};

export function qualifiesForMetrics(resource: DiscoveredResource): boolean {
  return METRIC_CATALOG[resource.resourceType]?.qualifies(resource) ?? false;
}

/** All CloudWatch queries for a resource (empty when its type has no catalog entry or it does not qualify). */
export function metricQueriesFor(resource: DiscoveredResource): MetricQuery[] {
  const entry = METRIC_CATALOG[resource.resourceType];
  if (!entry?.qualifies(resource)) return [];
  const dimensions: MetricDimension[] = [
    { name: entry.dimensionName, value: entry.dimensionValue(resource) },
    ...(entry.extraDimensions ?? []),
  ];
  return [
    ...entry.metrics.map(
      (spec): MetricQuery => ({
        key: metricKey(spec.metricName, spec.stat),
        namespace: spec.namespace ?? entry.namespace,
        metricName: spec.metricName,
        stat: spec.stat,
        unit: spec.unit,
        dimensions: spec.dimensions?.(resource) ?? dimensions,
      }),
    ),
    ...(entry.dynamicQueries?.(resource) ?? []),
  ];
}

/** CloudWatch region to query for a resource (us-east-1 for CloudFront, otherwise the resource's region). */
export function metricsRegionFor(resource: DiscoveredResource): string {
  return METRIC_CATALOG[resource.resourceType]?.metricsRegion?.(resource) ?? resource.region;
}
