/**
 * LOCAL DEVELOPMENT ONLY: seeds clearly-labelled SYNTHETIC data for UI development.
 *
 *   pnpm seed:synthetic -- --email you@example.com
 *
 * The user must have signed in to the local API once (so their tenant exists). The script creates
 * account 000000000000 with dataSource=SYNTHETIC, runs the REAL detection, recommendation and
 * persistence code over fabricated resources, and writes a SYNTHETIC cost snapshot. Savings are
 * priced with the live AWS Price List API when local AWS credentials are available; otherwise they
 * are reported as unavailable. It refuses to run against anything but DynamoDB Local.
 */
import { runDetection } from '@cloudsentry/analyzer';
import { persistScanResults } from '@cloudsentry/core';
import { createRepositories, ensureLocalTable } from '@cloudsentry/database';
import { createPricingService, estimateSavings, generateRecommendations } from '@cloudsentry/recommendation';
import {
  ARTIFACT_KEYS,
  RESOURCE_TYPES,
  metricKey,
  type CloudAccount,
  type CostSnapshot,
  type DiscoveredResource,
  type MetricStatisticName,
  type NormalizedResource,
  type ResourceUtilization,
  type ScanExecution,
} from '@cloudsentry/shared-types';
import { createLogger, isoDate, newId, resourceKeyFor, roundMoney } from '@cloudsentry/utilities';

const SYNTHETIC_ACCOUNT = '000000000000';
const REGION = 'us-east-1';
const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
const tableName = process.env.TABLE_NAME ?? 'cloudsentry-local';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(endpoint)) {
  throw new Error('seed-synthetic only runs against DynamoDB Local');
}
const emailArg = process.argv.indexOf('--email');
const email = emailArg > 0 ? process.argv[emailArg + 1] : undefined;
if (!email) throw new Error('Usage: pnpm seed:synthetic -- --email <local user email>');

const logger = createLogger({ service: 'seed-synthetic' });
const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const SYN_TAGS = { 'cloudsentry:synthetic': 'true' };

function util(
  ns: string,
  dimDays: number,
  metrics: [string, MetricStatisticName, number, number?][],
): ResourceUtilization {
  const expected = dimDays * 24;
  return {
    lookbackDays: 30,
    periodStart: daysAgo(30),
    periodEnd: now.toISOString(),
    collectedAt: now.toISOString(),
    observableDays: dimDays,
    metrics: Object.fromEntries(
      metrics.map(([name, stat, avg, max]) => [
        metricKey(name, stat),
        {
          namespace: ns,
          metricName: name,
          statistic: stat,
          periodSeconds: 3600,
          unit: null,
          availability: 'AVAILABLE' as const,
          stats: {
            average: avg,
            minimum: avg / 2,
            maximum: max ?? avg * 1.5,
            p50: avg,
            p95: max ?? avg * 1.3,
            p99: max ?? avg * 1.4,
            sum: avg * expected,
            datapoints: expected,
            expectedDatapoints: expected,
            coverage: 1,
            zeroFraction: avg === 0 ? 1 : 0,
          },
        },
      ]),
    ),
  };
}

function norm(r: DiscoveredResource, utilization: ResourceUtilization | null): NormalizedResource {
  return {
    ...r,
    resourceKey: resourceKeyFor(r.accountId, r.region, r.resourceType, r.resourceId),
    utilization,
  } as NormalizedResource;
}

const base = { accountId: SYNTHETIC_ACCOUNT, region: REGION, arn: null, tags: SYN_TAGS };
const ec2 = (
  id: string,
  name: string,
  type: string,
  cpu: number,
  cpuMax: number,
  net: number,
): NormalizedResource =>
  norm(
    {
      ...base,
      resourceType: 'EC2_INSTANCE',
      resourceId: id,
      name,
      state: 'running',
      tags: { ...SYN_TAGS, Name: name },
      createdAt: daysAgo(120),
      attributes: {
        instanceType: type,
        availabilityZone: 'us-east-1a',
        launchTime: daysAgo(120),
        platformDetails: 'Linux/UNIX',
        platform: null,
        tenancy: 'default',
        instanceLifecycle: null,
        publicIpAddress: null,
        privateIpAddress: '10.0.1.10',
        monitoringState: 'disabled',
        vpcId: 'vpc-synthetic',
        subnetId: 'subnet-synthetic',
        architecture: 'x86_64',
        attachedVolumeIds: [],
      },
    },
    util('AWS/EC2', 30, [
      ['CPUUtilization', 'Average', cpu, cpuMax],
      ['CPUUtilization', 'Maximum', cpuMax, cpuMax],
      ['NetworkIn', 'Sum', net, net * 2],
      ['NetworkOut', 'Sum', net, net * 2],
    ]),
  );

const resources: NormalizedResource[] = [
  ec2('i-0synthetic0000001', 'syn-idle-batch', 'm5.large', 1.2, 4, 20_000),
  ec2('i-0synthetic0000002', 'syn-web-1', 't3.medium', 38, 85, 50_000_000),
  norm(
    {
      ...base,
      resourceType: 'EBS_VOLUME',
      resourceId: 'vol-0synthetic00001',
      name: 'syn-orphaned-data',
      state: 'available',
      createdAt: daysAgo(95),
      attributes: {
        volumeType: 'gp3',
        sizeGiB: 500,
        iops: 3000,
        throughput: 125,
        availabilityZone: 'us-east-1a',
        encrypted: true,
        snapshotId: null,
        attachments: [],
        multiAttachEnabled: false,
      },
    },
    null,
  ),
  norm(
    {
      ...base,
      resourceType: 'ELASTIC_IP',
      resourceId: 'eipalloc-0synthetic01',
      name: null,
      state: 'unassociated',
      createdAt: null,
      attributes: {
        allocationId: 'eipalloc-0synthetic01',
        publicIp: '198.51.100.10',
        associationId: null,
        instanceId: null,
        networkInterfaceId: null,
        privateIpAddress: null,
        domain: 'vpc',
      },
    },
    null,
  ),
  norm(
    {
      ...base,
      resourceType: 'RDS_INSTANCE',
      resourceId: 'syn-reporting-db',
      name: 'syn-reporting-db',
      state: 'available',
      createdAt: daysAgo(200),
      attributes: {
        dbInstanceIdentifier: 'syn-reporting-db',
        engine: 'postgres',
        engineVersion: '16.4',
        instanceClass: 'db.m5.xlarge',
        allocatedStorageGiB: 200,
        storageType: 'gp3',
        availabilityZone: 'us-east-1b',
        multiAz: false,
        publiclyAccessible: false,
        storageEncrypted: true,
        licenseModel: 'postgresql-license',
        dbClusterIdentifier: null,
      },
    },
    util('AWS/RDS', 30, [
      ['CPUUtilization', 'Average', 3, 12],
      ['CPUUtilization', 'Maximum', 12, 12],
      ['DatabaseConnections', 'Average', 1.5, 6],
      ['DatabaseConnections', 'Maximum', 6, 6],
      ['ReadIOPS', 'Average', 2],
      ['WriteIOPS', 'Average', 3],
      ['FreeStorageSpace', 'Minimum', 150 * 1024 ** 3],
      ['FreeableMemory', 'Average', 12 * 1024 ** 3],
    ]),
  ),
  norm(
    {
      ...base,
      resourceType: 'EBS_SNAPSHOT',
      resourceId: 'snap-0synthetic00001',
      name: null,
      state: 'completed',
      createdAt: daysAgo(400),
      attributes: {
        snapshotId: 'snap-0synthetic00001',
        volumeId: 'vol-0deleted',
        volumeSizeGiB: 100,
        description: 'manual backup before migration',
        ownerId: SYNTHETIC_ACCOUNT,
        ownerAlias: null,
        progress: '100%',
        storageTier: 'standard',
        encrypted: true,
        sourceVolumeExists: false,
      },
    },
    null,
  ),
];

async function main(): Promise<void> {
  await ensureLocalTable(endpoint, tableName);
  const repos = createRepositories({ tableName, endpoint });
  // The local auth store maps email -> sub; the profile item then gives the tenant.
  const { readFileSync } = await import('node:fs');
  const { join, resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const store = JSON.parse(readFileSync(join(root, '.local', 'auth-users.json'), 'utf8')) as {
    users: Record<string, { sub: string }>;
  };
  const sub = store.users[email as string]?.sub;
  if (!sub) throw new Error(`No local user ${email}; register via the local API first`);
  const profile = await repos.tenants.getUserProfile(sub);
  if (!profile) throw new Error('User has not signed in yet; sign in once so the tenant is provisioned');
  const tenantId = profile.tenantId;
  const iso = now.toISOString();

  const account: CloudAccount = {
    tenantId,
    accountId: SYNTHETIC_ACCOUNT,
    alias: 'SYNTHETIC demo data (not a real AWS account)',
    roleArn: `arn:aws:iam::${SYNTHETIC_ACCOUNT}:role/CloudSentryReadOnlyRole`,
    externalId: 'synthetic',
    regions: [REGION],
    status: 'CONNECTED',
    dataSource: 'SYNTHETIC',
    connectionType: 'ROLE',
    organizationId: null,
    lastVerification: null,
    lastScanId: null,
    lastScanAt: iso,
    lastSuccessfulScanAt: iso,
    createdBy: sub,
    createdAt: iso,
    updatedAt: iso,
    version: 1,
  };
  const existing = await repos.accounts.get(tenantId, SYNTHETIC_ACCOUNT);
  if (!existing) await repos.accounts.create(account);

  const scanId = newId.scan();
  const scan: ScanExecution = {
    scanId,
    tenantId,
    accountId: SYNTHETIC_ACCOUNT,
    trigger: 'MANUAL',
    triggeredBy: sub,
    status: 'COMPLETED',
    executionArn: 'synthetic',
    regions: [REGION],
    requestedAt: iso,
    startedAt: iso,
    completedAt: iso,
    durationMs: 0,
    steps: {},
    discovery: RESOURCE_TYPES.map((t) => ({
      resourceType: t,
      status: 'SUCCEEDED' as const,
      resourceCount: resources.filter((r) => r.resourceType === t).length,
      regionsSucceeded: [REGION],
      regionsFailed: [],
      artifactKey: null,
      durationMs: 0,
    })),
    summary: null,
    errors: [],
    artifactsPrefix: ARTIFACT_KEYS.scanPrefix(SYNTHETIC_ACCOUNT, scanId, tenantId),
    cancelRequested: false,
    createdAt: iso,
    updatedAt: iso,
    version: 1,
  };
  await repos.scans.create(scan);

  const detection = runDetection(resources, {
    settings: await repos.settings.getDetectionSettings(tenantId),
    now,
  });
  const drafts = generateRecommendations(detection.issues);
  const pricing = createPricingService({ logger, cache: repos.priceCache });
  const priced = await Promise.all(drafts.map((d) => estimateSavings(d, pricing, now)));
  const outcome = await persistScanResults(
    repos,
    {
      tenantId,
      accountId: SYNTHETIC_ACCOUNT,
      scanId,
      now: iso,
      normalized: resources,
      discovery: scan.discovery,
      detection,
      priced,
    },
    logger,
  );

  // Synthetic cost series, labelled source=SYNTHETIC (never shown as Cost Explorer data).
  const daily = Array.from({ length: 45 }, (_, i) => {
    const d = new Date(now.getTime() - (44 - i) * 86_400_000);
    return {
      date: isoDate(d),
      amount: roundMoney(40 + 8 * Math.sin(i / 3) + (i === 40 ? 60 : 0)),
      unfinalized: i > 40,
    };
  });
  const month = isoDate(now).slice(0, 7);
  const snapshot: CostSnapshot = {
    tenantId,
    accountId: SYNTHETIC_ACCOUNT,
    currency: 'USD',
    source: 'SYNTHETIC',
    costMetric: 'SYNTHETIC',
    availability: 'AVAILABLE',
    unavailableReason: null,
    retrievedAt: iso,
    scanId,
    currentMonth: {
      start: `${month}-01`,
      end: isoDate(now),
      amount: roundMoney(daily.filter((d) => d.date.startsWith(month)).reduce((s, d) => s + d.amount, 0)),
      unfinalized: true,
    },
    previousMonth: { start: '', end: '', amount: 1290.55, unfinalized: false },
    previousMonthToDate: { amount: 610.2, unfinalized: false },
    monthlyTrend: Array.from({ length: 6 }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1));
      return { month: isoDate(d).slice(0, 7), amount: roundMoney(1100 + i * 45), unfinalized: i === 5 };
    }),
    daily,
    services: [
      { key: 'Amazon Elastic Compute Cloud - Compute', amount: 520.4 },
      { key: 'Amazon Relational Database Service', amount: 310.75 },
      { key: 'EC2 - Other', amount: 120.1 },
      { key: 'Amazon Virtual Private Cloud', amount: 44.6 },
    ],
    regions: [{ key: REGION, amount: 995.85 }],
    resourceLevel: { availability: 'UNAVAILABLE', reason: 'Synthetic data', items: [] },
    errors: [],
  };
  await repos.costs.put(snapshot);
  await repos.scans.update(tenantId, scanId, {
    summary: {
      resourcesDiscovered: resources.length,
      resourcesByType: {},
      findingsDetected: outcome.findingsDetected,
      newFindings: outcome.newFindingIds.length,
      reopenedFindings: outcome.reopenedFindingIds.length,
      resolvedFindings: outcome.resolvedFindingIds.length,
      criticalFindings: outcome.criticalFindings,
      openRecommendations: outcome.openRecommendations,
      potentialMonthlySavings: outcome.potentialMonthlySavings,
      metricsCoverage: {
        resourcesWithMetrics: resources.filter((r) => r.utilization).length,
        resourcesWithoutMetrics: resources.filter((r) => !r.utilization).length,
      },
      costDataAvailable: true,
    },
  });
  logger.info('SYNTHETIC data seeded', {
    tenantId,
    account: SYNTHETIC_ACCOUNT,
    findings: outcome.findingsDetected,
    potentialMonthlySavings: outcome.potentialMonthlySavings,
  });
}

await main();
