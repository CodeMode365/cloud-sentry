/**
 * SYNTHETIC TEST FIXTURES for recommendation/savings tests. Not real AWS data.
 */
import type {
  ArtifactEnvelope,
  DetectedIssue,
  PriceLookupResult,
  PriceQuery,
  SavingsRequest,
  ScanWorkflowState,
} from '@cloudsentry/shared-types';
import type { ArtifactStore } from '@cloudsentry/aws-clients';
import { findingIdFor, resourceKeyFor } from '@cloudsentry/utilities';
import type { PriceProvider } from '../pricing/provider';

export const NOW = new Date('2026-11-01T00:00:00.000Z');
export const ACCOUNT = '111122223333';

export function issue(
  overrides: Partial<DetectedIssue> & { savingsRequest?: SavingsRequest | null } = {},
): DetectedIssue {
  const resourceId = overrides.resourceId ?? 'vol-0abc';
  const ruleId = overrides.ruleId ?? 'unattached-ebs';
  return {
    findingId: findingIdFor(ACCOUNT, 'us-east-1', ruleId, resourceId),
    ruleId,
    ruleName: 'Unattached EBS volume',
    ruleVersion: 1,
    category: 'UNUSED',
    resourceType: 'EBS_VOLUME',
    resourceKey: resourceKeyFor(ACCOUNT, 'us-east-1', 'EBS_VOLUME', resourceId),
    accountId: ACCOUNT,
    region: 'us-east-1',
    resourceId,
    resourceName: null,
    title: 'Unattached EBS volume vol-0abc',
    description: 'Volume vol-0abc is unattached.',
    baseSeverity: 'MEDIUM',
    confidence: 'HIGH',
    riskLevel: 'MEDIUM',
    evidence: [],
    thresholds: { minAgeDays: 7 },
    suggestedAction: {
      type: 'DELETE_VOLUME',
      summary: 'Delete it after confirming.',
      steps: ['Confirm', 'Delete'],
    },
    savingsRequest: { kind: 'EBS_VOLUME_DELETE', region: 'us-east-1', volumeType: 'gp3', sizeGiB: 100 },
    ...overrides,
  };
}

/** Key under which FakePriceProvider looks up a price: the kind plus the attributes that change the price. */
export function fakePriceKey(query: PriceQuery): string {
  switch (query.kind) {
    case 'RDS_INSTANCE_HOURLY':
      return `RDS:${query.instanceClass}`;
    case 'LAMBDA_GB_SECOND':
    case 'LAMBDA_PROVISIONED_CONCURRENCY_GB_SECOND':
      return `${query.kind}:${query.architecture}`;
    case 'EKS_CLUSTER_HOURLY':
      return `${query.kind}:${query.supportType}`;
    case 'ELASTICACHE_NODE_HOURLY':
      return `${query.kind}:${query.cacheEngine}:${query.cacheNodeType}`;
    case 'EFS_STORAGE_GB_MONTH':
      return `${query.kind}:${query.storageClass}`;
    case 'DYNAMODB_PROVISIONED_CAPACITY_HOURLY':
      return `${query.kind}:${query.capacity}:${query.tableClass}`;
    case 'DYNAMODB_ON_DEMAND_REQUEST_UNIT':
      return `${query.kind}:${query.request}:${query.tableClass}`;
    case 'DYNAMODB_STORAGE_GB_MONTH':
      return `${query.kind}:${query.tableClass}`;
    case 'REDSHIFT_NODE_HOURLY':
      return `${query.kind}:${query.nodeType}`;
    default:
      return query.kind;
  }
}

function fakeUnit(query: PriceQuery): string {
  if (query.kind.endsWith('GB_MONTH')) return 'GB-Mo';
  if (query.kind.startsWith('LAMBDA_')) return 'Lambda-GB-Second';
  if (query.kind === 'DYNAMODB_ON_DEMAND_REQUEST_UNIT')
    return `${query.request === 'READ' ? 'Read' : 'Write'}RequestUnits`;
  return 'Hrs';
}

/**
 * Synthetic unit prices used by default. The values for the extended services mirror the examples verified in
 * docs/architecture/extended-services.md (us-east-1, 2026-11-14); they are test data, never used at runtime.
 */
export const DEFAULT_FAKE_PRICES: Readonly<Record<string, number>> = {
  EC2_INSTANCE_HOURLY: 0.0832,
  EBS_STORAGE_GB_MONTH: 0.08,
  EBS_SNAPSHOT_GB_MONTH: 0.05,
  PUBLIC_IPV4_IDLE_HOURLY: 0.005,
  NAT_GATEWAY_HOURLY: 0.045,
  'RDS:db.m5.2xlarge': 0.712,
  'RDS:db.m5.xlarge': 0.356,
  'LAMBDA_GB_SECOND:x86_64': 0.0000166667,
  'LAMBDA_GB_SECOND:arm64': 0.0000133334,
  'LAMBDA_PROVISIONED_CONCURRENCY_GB_SECOND:x86_64': 0.0000041667,
  'EKS_CLUSTER_HOURLY:STANDARD': 0.1,
  'EKS_CLUSTER_HOURLY:EXTENDED': 0.5,
  'ELASTICACHE_NODE_HOURLY:Redis:cache.r6g.xlarge': 0.411,
  'ELASTICACHE_NODE_HOURLY:Redis:cache.r6g.large': 0.206,
  'ELASTICACHE_NODE_HOURLY:Valkey:cache.r6g.large': 0.1648,
  'ELASTICACHE_NODE_HOURLY:Memcached:cache.t3.micro': 0.017,
  'EFS_STORAGE_GB_MONTH:General Purpose': 0.3,
  'EFS_STORAGE_GB_MONTH:Infrequent Access': 0.025,
  'EFS_STORAGE_GB_MONTH:Archive': 0.008,
  'EFS_STORAGE_GB_MONTH:One Zone-General Purpose': 0.16,
  'EFS_STORAGE_GB_MONTH:One Zone-Infrequent Access': 0.0133,
  'DYNAMODB_PROVISIONED_CAPACITY_HOURLY:READ:STANDARD': 0.00013,
  'DYNAMODB_PROVISIONED_CAPACITY_HOURLY:WRITE:STANDARD': 0.00065,
  'DYNAMODB_PROVISIONED_CAPACITY_HOURLY:READ:STANDARD_INFREQUENT_ACCESS': 0.00016,
  'DYNAMODB_PROVISIONED_CAPACITY_HOURLY:WRITE:STANDARD_INFREQUENT_ACCESS': 0.00081,
  'DYNAMODB_ON_DEMAND_REQUEST_UNIT:READ:STANDARD': 0.000000125,
  'DYNAMODB_ON_DEMAND_REQUEST_UNIT:WRITE:STANDARD': 0.000000625,
  'DYNAMODB_STORAGE_GB_MONTH:STANDARD': 0.25,
  'DYNAMODB_STORAGE_GB_MONTH:STANDARD_INFREQUENT_ACCESS': 0.1,
  'REDSHIFT_NODE_HOURLY:ra3.xlplus': 1.086,
};

/** Fake provider with fixed synthetic unit prices keyed by `fakePriceKey`. */
export class FakePriceProvider implements PriceProvider {
  calls: PriceQuery[] = [];
  constructor(private readonly prices: Partial<Record<string, number | null>> = DEFAULT_FAKE_PRICES) {}
  async getPrice(query: PriceQuery): Promise<PriceLookupResult> {
    this.calls.push(query);
    const key = fakePriceKey(query);
    const value = this.prices[key];
    if (value === undefined || value === null) {
      return { query, price: null, unavailableReason: `NO_MATCHING_PRICE: none for ${key}` };
    }
    return {
      query,
      price: {
        unitPriceUsd: value,
        unit: fakeUnit(query),
        sku: `SKU-${key}`,
        description: null,
        effectiveDate: '2026-10-01T00:00:00Z',
        source: 'AWS_PRICE_LIST_API',
        retrievedAt: NOW.toISOString(),
      },
    };
  }
}

export class MemoryArtifacts implements ArtifactStore {
  objects = new Map<string, unknown>();
  async putJson(key: string, value: unknown) {
    this.objects.set(key, JSON.parse(JSON.stringify(value)));
  }
  async getJson<T>(key: string): Promise<T> {
    if (!this.objects.has(key)) throw new Error(`missing ${key}`);
    return this.objects.get(key) as T;
  }
  async putObject() {
    return { sizeBytes: 0 };
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
  async getDownloadUrl() {
    return '';
  }
}

export const PREFIX = `scans/t1/${ACCOUNT}/scan_1/`;

export function baseState(extra: Partial<ScanWorkflowState> = {}): ScanWorkflowState {
  return {
    tenantId: 't1',
    accountId: ACCOUNT,
    scanId: 'scan_1',
    trigger: 'MANUAL',
    validation: { regions: ['us-east-1'], lookbackDays: 30, artifactsPrefix: PREFIX },
    ...extra,
  };
}

export function envelope<T>(data: T, overrides: Partial<ArtifactEnvelope<T>> = {}): ArtifactEnvelope<T> {
  return {
    schemaVersion: 1,
    tenantId: 't1',
    accountId: ACCOUNT,
    scanId: 'scan_1',
    createdAt: NOW.toISOString(),
    data,
    ...overrides,
  };
}
