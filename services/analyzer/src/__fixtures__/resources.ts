/**
 * SYNTHETIC TEST FIXTURES. These builders create fake resources for unit tests only; they are never real
 * AWS data and must not be used outside tests.
 */
import {
  metricKey,
  type DiscoveredResourceOf,
  type MetricSeriesSummary,
  type MetricStatisticName,
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
    stats:
      availability === 'AVAILABLE'
        ? {
            average: spec.average ?? null,
            minimum: spec.minimum ?? spec.average ?? null,
            maximum: spec.maximum ?? spec.average ?? null,
            p50: spec.average ?? null,
            p95: spec.p95 ?? spec.maximum ?? spec.average ?? null,
            p99: spec.maximum ?? spec.average ?? null,
            sum:
              spec.sum ??
              (spec.average !== null && spec.average !== undefined
                ? spec.average * expected * coverage
                : null),
            datapoints: Math.round(expected * coverage),
            expectedDatapoints: expected,
            coverage,
          }
        : null,
  };
}

export function utilizationOf(metrics: MetricSeriesSummary[], observableDays = 30): ResourceUtilization {
  return {
    lookbackDays: 30,
    periodStart: daysAgo(observableDays),
    periodEnd: FIXTURE_NOW.toISOString(),
    collectedAt: FIXTURE_NOW.toISOString(),
    observableDays,
    metrics: Object.fromEntries(metrics.map((m) => [metricKey(m.metricName, m.statistic), m])),
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
