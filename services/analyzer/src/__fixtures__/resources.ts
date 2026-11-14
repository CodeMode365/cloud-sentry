/**
 * SYNTHETIC TEST FIXTURES. These builders create fake resources for unit tests only; they are never real
 * AWS data and must not be used outside tests.
 */
import {
  BACKUP_AGE_BUCKETS_DAYS,
  GLOBAL_REGION,
  metricKey,
  type BackupVaultResourceTypeSummary,
  type DiscoveredResourceOf,
  type MetricSeriesSummary,
  type MetricStatisticName,
  type MetricStatistics,
  type NormalizedResource,
  type ResourceType,
  type ResourceUtilization,
} from '@cloudsentry/shared-types';
import { resourceKeyFor } from '@cloudsentry/utilities';

export const SYNTHETIC_ACCOUNT_ID = '111122223333';
export const SYNTHETIC_REGION = 'us-east-1';
export const FIXTURE_NOW = new Date('2026-11-01T00:00:00.000Z');

export function daysAgo(days: number, now: Date = FIXTURE_NOW): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export interface SeriesSpec {
  average?: number | null;
  minimum?: number | null;
  maximum?: number | null;
  sum?: number | null;
  p95?: number | null;
  coverage?: number;
  /** Share of datapoints equal to 0; defaults to 1 when the maximum is 0, else 0 (null without datapoints). */
  zeroFraction?: number | null;
  /** Override availability; when not AVAILABLE, stats are null. */
  availability?: MetricSeriesSummary['availability'];
}

export function series(
  namespace: string,
  metricName: string,
  statistic: MetricStatisticName,
  spec: SeriesSpec,
  observableDays = 30,
): MetricSeriesSummary {
  const availability = spec.availability ?? 'AVAILABLE';
  const expected = Math.round(observableDays * 24);
  const coverage = spec.coverage ?? 1;
  return {
    namespace,
    metricName,
    statistic,
    periodSeconds: 3600,
    unit: null,
    availability,
    stats: availability === 'AVAILABLE' ? statsFor(spec, expected, coverage) : null,
  };
}

function statsFor(spec: SeriesSpec, expected: number, coverage: number): MetricStatistics {
  const maximum = spec.maximum ?? spec.average ?? null;
  const datapoints = Math.round(expected * coverage);
  return {
    average: spec.average ?? null,
    minimum: spec.minimum ?? spec.average ?? null,
    maximum,
    p50: spec.average ?? null,
    p95: spec.p95 ?? spec.maximum ?? spec.average ?? null,
    p99: spec.maximum ?? spec.average ?? null,
    sum:
      spec.sum ??
      (spec.average !== null && spec.average !== undefined ? spec.average * expected * coverage : null),
    datapoints,
    expectedDatapoints: expected,
    coverage,
    zeroFraction:
      spec.zeroFraction !== undefined ? spec.zeroFraction : datapoints === 0 ? null : maximum === 0 ? 1 : 0,
  };
}

export function utilizationOf(
  metrics: MetricSeriesSummary[],
  observableDays = 30,
  /** Series stored under explicit keys (e.g. "ProvisionedConcurrencyUtilization:Maximum:live"). */
  keyed: Record<string, MetricSeriesSummary> = {},
): ResourceUtilization {
  return {
    lookbackDays: 30,
    periodStart: daysAgo(observableDays),
    periodEnd: FIXTURE_NOW.toISOString(),
    collectedAt: FIXTURE_NOW.toISOString(),
    observableDays,
    metrics: {
      ...Object.fromEntries(metrics.map((m) => [metricKey(m.metricName, m.statistic), m])),
      ...keyed,
    },
  };
}

type Overrides<K extends ResourceType> = Partial<
  Omit<DiscoveredResourceOf<K>, 'attributes' | 'resourceType'>
> & {
  attributes?: Partial<DiscoveredResourceOf<K>['attributes']>;
  utilization?: ResourceUtilization | null;
};

function build<K extends ResourceType>(
  resourceType: K,
  resourceId: string,
  defaults: { state: string; createdAt: string | null; attributes: DiscoveredResourceOf<K>['attributes'] },
  o: Overrides<K>,
): Extract<NormalizedResource, { resourceType: K }> {
  const accountId = o.accountId ?? SYNTHETIC_ACCOUNT_ID;
  const region = o.region ?? SYNTHETIC_REGION;
  const id = o.resourceId ?? resourceId;
  return {
    accountId,
    region,
    resourceId: id,
    arn: o.arn ?? null,
    name: o.name ?? null,
    state: o.state ?? defaults.state,
    tags: o.tags ?? {},
    createdAt: o.createdAt === undefined ? defaults.createdAt : o.createdAt,
    resourceType,
    attributes: { ...defaults.attributes, ...(o.attributes ?? {}) },
    resourceKey: resourceKeyFor(accountId, region, resourceType, id),
    utilization: o.utilization === undefined ? null : o.utilization,
  } as unknown as Extract<NormalizedResource, { resourceType: K }>;
}

/** Hourly network sum (bytes) giving `mbPerDay` MB per day when added for in+out halves. */
export function hourlyBytesForMbPerDay(mbPerDay: number): number {
  return (mbPerDay * 1_000_000) / 24;
}

export function idleEc2Metrics(
  opts: {
    cpuAvg?: number;
    cpuMax?: number;
    netMbPerDay?: number;
    coverage?: number;
    observableDays?: number;
  } = {},
): ResourceUtilization {
  const days = opts.observableDays ?? 30;
  const half = hourlyBytesForMbPerDay((opts.netMbPerDay ?? 1) / 2);
  const cov = opts.coverage ?? 1;
  return utilizationOf(
    [
      series(
        'AWS/EC2',
        'CPUUtilization',
        'Average',
        { average: opts.cpuAvg ?? 1.2, p95: 2, coverage: cov },
        days,
      ),
      series(
        'AWS/EC2',
        'CPUUtilization',
        'Maximum',
        { average: 3, maximum: opts.cpuMax ?? 4.5, coverage: cov },
        days,
      ),
      series('AWS/EC2', 'NetworkIn', 'Sum', { average: half, coverage: cov }, days),
      series('AWS/EC2', 'NetworkOut', 'Sum', { average: half, coverage: cov }, days),
    ],
    days,
  );
}

export function ec2Instance(o: Overrides<'EC2_INSTANCE'> = {}) {
  return build(
    'EC2_INSTANCE',
    'i-0abc1234def567890',
    {
      state: 'running',
      createdAt: daysAgo(90),
      attributes: {
        instanceType: 't3.large',
        availabilityZone: 'us-east-1a',
        launchTime: daysAgo(90),
        platformDetails: 'Linux/UNIX',
        platform: null,
        tenancy: 'default',
        instanceLifecycle: null,
        publicIpAddress: null,
        privateIpAddress: '10.0.0.10',
        monitoringState: 'disabled',
        vpcId: 'vpc-0123',
        subnetId: 'subnet-0123',
        architecture: 'x86_64',
        attachedVolumeIds: ['vol-0aaa'],
      },
    },
    o,
  );
}

export function ebsVolume(o: Overrides<'EBS_VOLUME'> = {}) {
  return build(
    'EBS_VOLUME',
    'vol-0abc1234def567890',
    {
      state: 'available',
      createdAt: daysAgo(45),
      attributes: {
        volumeType: 'gp3',
        sizeGiB: 100,
        iops: 3000,
        throughput: 125,
        availabilityZone: 'us-east-1a',
        encrypted: true,
        snapshotId: null,
        attachments: [],
        multiAttachEnabled: false,
      },
    },
    o,
  );
}

export function elasticIp(o: Overrides<'ELASTIC_IP'> = {}) {
  return build(
    'ELASTIC_IP',
    'eipalloc-0abc1234',
    {
      state: 'unassociated',
      createdAt: null,
      attributes: {
        allocationId: 'eipalloc-0abc1234',
        publicIp: '198.51.100.10',
        associationId: null,
        instanceId: null,
        networkInterfaceId: null,
        privateIpAddress: null,
        domain: 'vpc',
      },
    },
    o,
  );
}

export function rdsMetrics(
  opts: {
    cpuAvg?: number;
    cpuMax?: number;
    connAvg?: number;
    connMax?: number;
    readIops?: number;
    writeIops?: number;
    coverage?: number;
    observableDays?: number;
    freeStorageBytes?: number;
  } = {},
): ResourceUtilization {
  const days = opts.observableDays ?? 30;
  const cov = opts.coverage ?? 1;
  return utilizationOf(
    [
      series('AWS/RDS', 'CPUUtilization', 'Average', { average: opts.cpuAvg ?? 3, coverage: cov }, days),
      series(
        'AWS/RDS',
        'CPUUtilization',
        'Maximum',
        { average: 10, maximum: opts.cpuMax ?? 15, coverage: cov },
        days,
      ),
      series(
        'AWS/RDS',
        'DatabaseConnections',
        'Average',
        { average: opts.connAvg ?? 1, coverage: cov },
        days,
      ),
      series(
        'AWS/RDS',
        'DatabaseConnections',
        'Maximum',
        { average: 2, maximum: opts.connMax ?? 3, coverage: cov },
        days,
      ),
      series('AWS/RDS', 'ReadIOPS', 'Average', { average: opts.readIops ?? 2, coverage: cov }, days),
      series('AWS/RDS', 'WriteIOPS', 'Average', { average: opts.writeIops ?? 3, coverage: cov }, days),
      series(
        'AWS/RDS',
        'FreeStorageSpace',
        'Minimum',
        {
          average: opts.freeStorageBytes ?? 90 * 1024 ** 3,
          minimum: opts.freeStorageBytes ?? 90 * 1024 ** 3,
          coverage: cov,
        },
        days,
      ),
    ],
    days,
  );
}

export function rdsInstance(o: Overrides<'RDS_INSTANCE'> = {}) {
  return build(
    'RDS_INSTANCE',
    'orders-db',
    {
      state: 'available',
      createdAt: daysAgo(200),
      attributes: {
        dbInstanceIdentifier: 'orders-db',
        engine: 'postgres',
        engineVersion: '16.4',
        instanceClass: 'db.m5.2xlarge',
        allocatedStorageGiB: 100,
        storageType: 'gp3',
        availabilityZone: 'us-east-1a',
        multiAz: false,
        publiclyAccessible: false,
        storageEncrypted: true,
        licenseModel: 'postgresql-license',
        dbClusterIdentifier: null,
      },
    },
    o,
  );
}

export function ebsSnapshot(o: Overrides<'EBS_SNAPSHOT'> = {}) {
  return build(
    'EBS_SNAPSHOT',
    'snap-0abc1234def567890',
    {
      state: 'completed',
      createdAt: daysAgo(400),
      attributes: {
        snapshotId: 'snap-0abc1234def567890',
        volumeId: 'vol-0deadbeef',
        volumeSizeGiB: 50,
        description: 'manual backup',
        ownerId: SYNTHETIC_ACCOUNT_ID,
        ownerAlias: null,
        progress: '100%',
        storageTier: 'standard',
        encrypted: true,
        sourceVolumeExists: true,
      },
    },
    o,
  );
}

export function natMetrics(
  opts: { gbPerDay?: number; maxConn?: number; coverage?: number; observableDays?: number } = {},
): ResourceUtilization {
  const days = opts.observableDays ?? 30;
  const cov = opts.coverage ?? 1;
  const halfHourly = ((opts.gbPerDay ?? 0.05) * 1e9) / 2 / 24;
  return utilizationOf(
    [
      series('AWS/NATGateway', 'BytesOutToDestination', 'Sum', { average: halfHourly, coverage: cov }, days),
      series('AWS/NATGateway', 'BytesInFromDestination', 'Sum', { average: halfHourly, coverage: cov }, days),
      series(
        'AWS/NATGateway',
        'ActiveConnectionCount',
        'Maximum',
        { average: 1, maximum: opts.maxConn ?? 2, coverage: cov },
        days,
      ),
    ],
    days,
  );
}

export function natGateway(o: Overrides<'NAT_GATEWAY'> = {}) {
  return build(
    'NAT_GATEWAY',
    'nat-0abc1234def567890',
    {
      state: 'available',
      createdAt: daysAgo(120),
      attributes: {
        natGatewayId: 'nat-0abc1234def567890',
        subnetId: 'subnet-0123',
        vpcId: 'vpc-0123',
        connectivityType: 'public',
        publicIps: ['198.51.100.20'],
      },
    },
    o,
  );
}

// ---------------------------------------------------------------- Extended services

export const GIB = 1024 ** 3;

const NO_DATA: SeriesSpec = { availability: 'NO_DATA' };

/** Builds a series or a NO_DATA series when `value` is null. */
function maybe(
  namespace: string,
  metricName: string,
  statistic: MetricStatisticName,
  spec: SeriesSpec | null,
  days: number,
): MetricSeriesSummary {
  return series(namespace, metricName, statistic, spec ?? NO_DATA, days);
}

export function lambdaFunction(o: Overrides<'LAMBDA_FUNCTION'> = {}) {
  return build(
    'LAMBDA_FUNCTION',
    'arn:aws:lambda:us-east-1:111122223333:function:orders-api',
    {
      state: 'Active',
      createdAt: null,
      attributes: {
        functionName: 'orders-api',
        runtime: 'nodejs20.x',
        architecture: 'x86_64',
        memoryMb: 1024,
        timeoutSeconds: 30,
        packageType: 'Zip',
        ephemeralStorageMb: 512,
        lastModified: daysAgo(60),
        provisionedConcurrency: [],
      },
    },
    { name: 'orders-api', ...o },
  );
}

export interface LambdaMetricOptions {
  /** Total invocations over the window (null = NO_DATA). */
  invocations?: number | null;
  /** Total billed duration over the window in ms (null = NO_DATA). */
  durationSumMs?: number | null;
  /** p95 of hourly Duration:Maximum in ms. */
  durationMaxP95?: number;
  /** Lambda Insights peak memory utilization percent (null = NO_DATA, i.e. Insights not enabled). */
  memoryUtilMax?: number | null;
  /** Lambda Insights peak used memory in MB (null = NO_DATA). */
  usedMemoryMaxMb?: number | null;
  /** Provisioned concurrency peak utilization in percent (0-100, scanner-scaled) per qualifier; null = NO_DATA. */
  pcUtilization?: Record<string, number | null>;
  coverage?: number;
  observableDays?: number;
}

export function lambdaMetrics(opts: LambdaMetricOptions = {}): ResourceUtilization {
  const days = opts.observableDays ?? 30;
  const coverage = opts.coverage ?? 0.5;
  const invocations = opts.invocations === undefined ? 100_000 : opts.invocations;
  const durationSum = opts.durationSumMs === undefined ? 50_000_000 : opts.durationSumMs;
  const memUtil = opts.memoryUtilMax === undefined ? 25 : opts.memoryUtilMax;
  const usedMb = opts.usedMemoryMaxMb === undefined ? 256 : opts.usedMemoryMaxMb;
  const p95 = opts.durationMaxP95 ?? 2_000;
  const keyed: Record<string, MetricSeriesSummary> = {};
  for (const [qualifier, ratio] of Object.entries(opts.pcUtilization ?? {})) {
    keyed[`ProvisionedConcurrencyUtilization:Maximum:${qualifier}`] = maybe(
      'AWS/Lambda',
      'ProvisionedConcurrencyUtilization',
      'Maximum',
      ratio === null ? null : { average: ratio / 2, maximum: ratio, coverage },
      days,
    );
  }
  return utilizationOf(
    [
      maybe(
        'AWS/Lambda',
        'Invocations',
        'Sum',
        invocations === null ? null : { average: 10, sum: invocations, coverage },
        days,
      ),
      maybe(
        'AWS/Lambda',
        'Duration',
        'Sum',
        durationSum === null ? null : { average: 10, sum: durationSum, coverage },
        days,
      ),
      series(
        'AWS/Lambda',
        'Duration',
        'Maximum',
        { average: p95 / 2, p95, maximum: p95 * 1.1, coverage },
        days,
      ),
      series('AWS/Lambda', 'Errors', 'Sum', { average: 0, sum: 3, maximum: 1, coverage }, days),
      maybe(
        'LambdaInsights',
        'memory_utilization',
        'Maximum',
        memUtil === null ? null : { average: memUtil / 2, maximum: memUtil, coverage },
        days,
      ),
      maybe(
        'LambdaInsights',
        'used_memory_max',
        'Maximum',
        usedMb === null ? null : { average: usedMb / 2, maximum: usedMb, coverage },
        days,
      ),
    ],
    days,
    keyed,
  );
}

export function eksCluster(o: Overrides<'EKS_CLUSTER'> = {}) {
  return build(
    'EKS_CLUSTER',
    'prod-eks',
    {
      state: 'ACTIVE',
      createdAt: daysAgo(120),
      attributes: {
        clusterName: 'prod-eks',
        version: '1.31',
        platformVersion: 'eks.10',
        supportType: 'STANDARD',
        autoModeEnabled: false,
        nodegroups: [
          {
            name: 'ng-general',
            status: 'ACTIVE',
            instanceTypes: ['m6i.xlarge'],
            capacityType: 'ON_DEMAND',
            amiType: 'AL2023_x86_64_STANDARD',
            desiredSize: 6,
            minSize: 2,
            maxSize: 10,
          },
        ],
        fargateProfileCount: 0,
      },
    },
    o,
  );
}

export interface EksMetricOptions {
  cpuAvg?: number;
  cpuP95?: number;
  memAvg?: number;
  memP95?: number;
  cpuReserved?: number;
  memReserved?: number;
  /** cluster_node_count maximum; null = NO_DATA. */
  nodeCount?: number | null;
  /** false = Container Insights not enabled (all NO_DATA). */
  containerInsights?: boolean;
  coverage?: number;
  observableDays?: number;
}

export function eksMetrics(opts: EksMetricOptions = {}): ResourceUtilization {
  const days = opts.observableDays ?? 30;
  const cov = opts.coverage ?? 1;
  const ci = opts.containerInsights ?? true;
  const spec = (s: SeriesSpec): SeriesSpec | null => (ci ? { ...s, coverage: cov } : null);
  const ns = 'ContainerInsights';
  const nodeCount = opts.nodeCount === undefined ? 6 : opts.nodeCount;
  return utilizationOf(
    [
      maybe(
        ns,
        'node_cpu_utilization',
        'Average',
        spec({ average: opts.cpuAvg ?? 12, p95: opts.cpuP95 ?? 20 }),
        days,
      ),
      maybe(ns, 'node_cpu_utilization', 'Maximum', spec({ average: 25, maximum: 45 }), days),
      maybe(
        ns,
        'node_memory_utilization',
        'Average',
        spec({ average: opts.memAvg ?? 20, p95: opts.memP95 ?? 30 }),
        days,
      ),
      maybe(ns, 'node_memory_utilization', 'Maximum', spec({ average: 35, maximum: 50 }), days),
      maybe(ns, 'node_cpu_reserved_capacity', 'Average', spec({ average: opts.cpuReserved ?? 40 }), days),
      maybe(ns, 'node_memory_reserved_capacity', 'Average', spec({ average: opts.memReserved ?? 45 }), days),
      maybe(
        ns,
        'cluster_node_count',
        'Average',
        nodeCount === null ? null : spec({ average: nodeCount, maximum: nodeCount }),
        days,
      ),
    ],
    days,
  );
}

export function elastiCacheCluster(o: Overrides<'ELASTICACHE_CLUSTER'> = {}) {
  return build(
    'ELASTICACHE_CLUSTER',
    'sessions-001',
    {
      state: 'available',
      createdAt: daysAgo(200),
      attributes: {
        cacheClusterId: 'sessions-001',
        engine: 'redis',
        engineVersion: '7.1',
        cacheNodeType: 'cache.r6g.xlarge',
        numCacheNodes: 1,
        replicationGroupId: null,
        preferredAvailabilityZone: 'us-east-1a',
        snapshotRetentionLimit: 1,
      },
    },
    o,
  );
}

export interface ElastiCacheMetricOptions {
  cpuAvg?: number;
  cpuMax?: number;
  /** null = EngineCPUUtilization not published. */
  engineCpuAvg?: number | null;
  engineCpuMax?: number;
  /** DatabaseMemoryUsagePercentage maximum; null = NO_DATA. */
  memMax?: number | null;
  /** CurrConnections maximum; null = NO_DATA. */
  connMax?: number | null;
  coverage?: number;
  observableDays?: number;
}

export function elastiCacheMetrics(opts: ElastiCacheMetricOptions = {}): ResourceUtilization {
  const days = opts.observableDays ?? 30;
  const coverage = opts.coverage ?? 1;
  const ns = 'AWS/ElastiCache';
  const engineAvg = opts.engineCpuAvg === undefined ? 3 : opts.engineCpuAvg;
  const memMax = opts.memMax === undefined ? 12 : opts.memMax;
  const connMax = opts.connMax === undefined ? 25 : opts.connMax;
  const metrics = [
    series(ns, 'CPUUtilization', 'Average', { average: opts.cpuAvg ?? 4, coverage }, days),
    series(ns, 'CPUUtilization', 'Maximum', { average: 6, maximum: opts.cpuMax ?? 12, coverage }, days),
    maybe(
      ns,
      'DatabaseMemoryUsagePercentage',
      'Maximum',
      memMax === null ? null : { average: memMax / 2, maximum: memMax, coverage },
      days,
    ),
    maybe(
      ns,
      'CurrConnections',
      'Maximum',
      connMax === null ? null : { average: connMax / 2, maximum: connMax, coverage },
      days,
    ),
    series(ns, 'NetworkBytesIn', 'Sum', { average: 1000, coverage }, days),
    series(ns, 'NetworkBytesOut', 'Sum', { average: 1000, coverage }, days),
  ];
  if (engineAvg !== null) {
    metrics.push(
      series(ns, 'EngineCPUUtilization', 'Average', { average: engineAvg, coverage }, days),
      series(
        ns,
        'EngineCPUUtilization',
        'Maximum',
        { average: engineAvg, maximum: opts.engineCpuMax ?? 15, coverage },
        days,
      ),
    );
  }
  return utilizationOf(metrics, days);
}

export function cloudFrontDistribution(o: Overrides<'CLOUDFRONT_DISTRIBUTION'> = {}) {
  return build(
    'CLOUDFRONT_DISTRIBUTION',
    'E1ABCDEF2GHIJK',
    {
      state: 'Enabled',
      createdAt: null,
      attributes: {
        distributionId: 'E1ABCDEF2GHIJK',
        domainName: 'd111111abcdef8.cloudfront.net',
        enabled: true,
        priceClass: 'PriceClass_All',
        httpVersion: 'http2',
        aliases: [],
        defaultCacheBehaviorCompress: false,
        originCount: 1,
        webAclId: null,
        lastModifiedTime: daysAgo(100),
      },
    },
    { region: GLOBAL_REGION, ...o },
  );
}

export function cloudFrontMetrics(
  opts: { requests?: number | null; bytes?: number | null; coverage?: number; observableDays?: number } = {},
): ResourceUtilization {
  const days = opts.observableDays ?? 30;
  const coverage = opts.coverage ?? 1;
  const requests = opts.requests === undefined ? 1_000_000 : opts.requests;
  const bytes = opts.bytes === undefined ? 50e9 : opts.bytes;
  return utilizationOf(
    [
      maybe(
        'AWS/CloudFront',
        'Requests',
        'Sum',
        requests === null ? null : { average: 1, sum: requests, maximum: requests, coverage },
        days,
      ),
      maybe(
        'AWS/CloudFront',
        'BytesDownloaded',
        'Sum',
        bytes === null ? null : { average: 1, sum: bytes, maximum: bytes, coverage },
        days,
      ),
    ],
    days,
  );
}

export function efsFileSystem(o: Overrides<'EFS_FILE_SYSTEM'> = {}) {
  return build(
    'EFS_FILE_SYSTEM',
    'fs-0abc1234def567890',
    {
      state: 'available',
      createdAt: daysAgo(180),
      attributes: {
        fileSystemId: 'fs-0abc1234def567890',
        performanceMode: 'generalPurpose',
        throughputMode: 'bursting',
        provisionedThroughputMibps: null,
        sizeBytesTotal: 200 * GIB,
        sizeBytesStandard: 200 * GIB,
        sizeBytesInfrequentAccess: 0,
        sizeBytesArchive: 0,
        numberOfMountTargets: 2,
        encrypted: true,
        availabilityZoneName: null,
        lifecycle: { transitionToIA: null, transitionToArchive: null, transitionToPrimary: null },
      },
    },
    o,
  );
}

export function efsMetrics(
  opts: {
    connMax?: number | null;
    readBytes?: number | null;
    writeBytes?: number | null;
    coverage?: number;
    observableDays?: number;
  } = {},
): ResourceUtilization {
  const days = opts.observableDays ?? 30;
  const coverage = opts.coverage ?? 1;
  const ns = 'AWS/EFS';
  const v = (x: number | null | undefined, d: number) => (x === undefined ? d : x);
  const connMax = v(opts.connMax, 0);
  const read = v(opts.readBytes, 0);
  const write = v(opts.writeBytes, 0);
  return utilizationOf(
    [
      maybe(
        ns,
        'ClientConnections',
        'Maximum',
        connMax === null ? null : { average: connMax / 2, maximum: connMax, coverage },
        days,
      ),
      maybe(
        ns,
        'DataReadIOBytes',
        'Sum',
        read === null ? null : { average: read > 0 ? 1 : 0, sum: read, maximum: read, coverage },
        days,
      ),
      maybe(
        ns,
        'DataWriteIOBytes',
        'Sum',
        write === null ? null : { average: write > 0 ? 1 : 0, sum: write, maximum: write, coverage },
        days,
      ),
    ],
    days,
  );
}

export function dynamoDbTable(o: Overrides<'DYNAMODB_TABLE'> = {}) {
  return build(
    'DYNAMODB_TABLE',
    'orders',
    {
      state: 'ACTIVE',
      createdAt: daysAgo(365),
      attributes: {
        tableName: 'orders',
        billingMode: 'PROVISIONED',
        tableClass: 'STANDARD',
        provisionedReadCapacityUnits: 100,
        provisionedWriteCapacityUnits: 50,
        gsiCount: 0,
        gsiProvisionedReadCapacityUnits: 0,
        gsiProvisionedWriteCapacityUnits: 0,
        tableSizeBytes: 5 * GIB,
        itemCount: 1_000_000,
        autoScalingEnabled: false,
        deletionProtectionEnabled: false,
        replicaRegions: [],
      },
    },
    o,
  );
}

/** Per-second consumption profile of one side; converted to hourly Sum datapoints (x 3600). */
export interface CapacityProfileSpec {
  avg: number;
  p95: number;
  max: number;
}

export function dynamoDbMetrics(
  opts: {
    read?: CapacityProfileSpec | null;
    write?: CapacityProfileSpec | null;
    readThrottles?: number;
    writeThrottles?: number;
    coverage?: number;
    observableDays?: number;
  } = {},
): ResourceUtilization {
  const days = opts.observableDays ?? 30;
  const coverage = opts.coverage ?? 1;
  const ns = 'AWS/DynamoDB';
  // Steady low traffic by default: rightsizing candidate, not spiky.
  const read = opts.read === undefined ? { avg: 8, p95: 10, max: 12 } : opts.read;
  const write = opts.write === undefined ? { avg: 4, p95: 5, max: 6 } : opts.write;
  const sumSpec = (p: CapacityProfileSpec | null): SeriesSpec | null =>
    p === null
      ? null
      : { average: p.avg * 3600, p95: p.p95 * 3600, maximum: p.max * 3600, minimum: 0, coverage };
  const metrics = [
    maybe(ns, 'ConsumedReadCapacityUnits', 'Sum', sumSpec(read), days),
    maybe(ns, 'ConsumedWriteCapacityUnits', 'Sum', sumSpec(write), days),
  ];
  if (opts.readThrottles !== undefined) {
    metrics.push(
      series(ns, 'ReadThrottleEvents', 'Sum', { average: 0, sum: opts.readThrottles, coverage }, days),
    );
  }
  if (opts.writeThrottles !== undefined) {
    metrics.push(
      series(ns, 'WriteThrottleEvents', 'Sum', { average: 0, sum: opts.writeThrottles, coverage }, days),
    );
  }
  return utilizationOf(metrics, days);
}

export function redshiftCluster(o: Overrides<'REDSHIFT_CLUSTER'> = {}) {
  return build(
    'REDSHIFT_CLUSTER',
    'analytics',
    {
      state: 'available',
      createdAt: daysAgo(300),
      attributes: {
        clusterIdentifier: 'analytics',
        nodeType: 'ra3.xlplus',
        numberOfNodes: 2,
        clusterStatus: 'available',
        availabilityStatus: 'Available',
        encrypted: true,
        multiAz: false,
        automatedSnapshotRetentionPeriod: 1,
      },
    },
    o,
  );
}

export function redshiftMetrics(
  opts: {
    connMax?: number | null;
    zeroFraction?: number | null;
    coverage?: number;
    observableDays?: number;
  } = {},
): ResourceUtilization {
  const days = opts.observableDays ?? 30;
  const coverage = opts.coverage ?? 1;
  const ns = 'AWS/Redshift';
  const connMax = opts.connMax === undefined ? 12 : opts.connMax;
  return utilizationOf(
    [
      maybe(
        ns,
        'DatabaseConnections',
        'Maximum',
        connMax === null
          ? null
          : {
              average: connMax / 3,
              maximum: connMax,
              coverage,
              ...(opts.zeroFraction !== undefined
                ? { zeroFraction: opts.zeroFraction }
                : connMax > 0
                  ? { zeroFraction: 0.1 }
                  : {}),
            },
        days,
      ),
      series(
        ns,
        'DatabaseConnections',
        'Average',
        { average: connMax === null ? 0 : connMax / 4, coverage },
        days,
      ),
      series(ns, 'CPUUtilization', 'Average', { average: 3, coverage }, days),
      series(ns, 'PercentageDiskSpaceUsed', 'Average', { average: 20, coverage }, days),
    ],
    days,
  );
}

export function backupPlan(o: Overrides<'BACKUP_PLAN'> = {}) {
  return build(
    'BACKUP_PLAN',
    'plan-1111-2222',
    {
      state: 'active',
      createdAt: daysAgo(400),
      attributes: {
        backupPlanId: 'plan-1111-2222',
        backupPlanName: 'daily-backups',
        versionId: 'v1',
        lastExecutionDate: daysAgo(1),
        rules: [
          {
            ruleName: 'daily',
            targetVaultName: 'Default',
            scheduleExpression: 'cron(0 5 ? * * *)',
            deleteAfterDays: 35,
            moveToColdStorageAfterDays: null,
            copyActionCount: 0,
          },
        ],
      },
    },
    { name: 'daily-backups', ...o },
  );
}

/** Vault summary for one AWS Backup resource type from per-bucket { count, bytes } (keys = minDays). */
export function vaultSummary(
  resourceType: string,
  buckets: Partial<Record<(typeof BACKUP_AGE_BUCKETS_DAYS)[number], { count: number; bytes: number }>>,
): BackupVaultResourceTypeSummary {
  const byAge = BACKUP_AGE_BUCKETS_DAYS.map((minDays) => ({
    minDays,
    count: buckets[minDays]?.count ?? 0,
    bytes: buckets[minDays]?.bytes ?? 0,
  }));
  return {
    resourceType,
    count: byAge.reduce((s, b) => s + b.count, 0),
    bytes: byAge.reduce((s, b) => s + b.bytes, 0),
    byAge,
  };
}

export function backupVault(o: Overrides<'BACKUP_VAULT'> = {}) {
  return build(
    'BACKUP_VAULT',
    'Default',
    {
      state: 'active',
      createdAt: daysAgo(500),
      attributes: {
        vaultName: 'Default',
        locked: false,
        recoveryPointCount: 0,
        totalBytes: 0,
        truncated: false,
        oldestRecoveryPointAt: null,
        byResourceType: [],
        resourcesWithMultiplePlans: [],
      },
    },
    { name: 'Default', ...o },
  );
}
