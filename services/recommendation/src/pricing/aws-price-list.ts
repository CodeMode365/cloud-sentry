import {
  GetProductsCommand,
  type GetProductsCommandOutput,
  type PricingClient,
} from '@aws-sdk/client-pricing';
import type { PriceLookupResult, PricePoint, PriceQuery } from '@cloudsentry/shared-types';
import {
  awsErrorName,
  errorMessage,
  type Logger,
  type RetryOptions,
  withRetry,
} from '@cloudsentry/utilities';
import { PRICE_UNAVAILABLE, type PriceProvider } from './provider';

/**
 * Which price dimension of a (possibly tiered) Price List product to use.
 * - `first`: the dimension whose beginRange is "0" (or that has no range): tier 1, normally the highest price.
 * - `paid`: the dimension with the highest beginRange whose price is > 0. Used where the beginRange "0" row is
 *   a $0 Free Tier allowance (DynamoDB provisioned capacity and storage).
 */
export type TierStrategy = 'first' | 'paid';

export interface QuerySpec {
  serviceCode: string;
  filters: Record<string, string>;
  /** Matched against product.attributes.usagetype (which may carry a region prefix such as "USW2-"). */
  usageType: RegExp;
  /** Products whose usagetype matches this pattern are discarded even when `usageType` matches (decoy SKUs). */
  excludeUsageType?: RegExp;
  /** Expected price-dimension unit (compared case-insensitively). */
  unit: string;
  /** Other spellings of the same unit accepted for this service. */
  alternateUnits?: readonly string[];
  tier: TierStrategy;
}

/** Optional region prefix of a Price List usage type, e.g. "USW2-", "EUC1-", "APS3-" (absent in us-east-1). */
const REGION_PREFIX = '(?:[A-Z]{2,4}\\d?-)?';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** usagetype ending with `name`, optionally region-prefixed ("USW2-name"). */
function usageSuffix(name: string): RegExp {
  return new RegExp(`(^|-)${escapeRegExp(name)}$`);
}

/** usagetype exactly `name` after an optional region prefix. */
function usageExact(name: string): RegExp {
  return new RegExp(`^${REGION_PREFIX}${escapeRegExp(name)}$`);
}

/** Price List `storageClass` value -> usagetype suffix of its storage (GB-month) product. */
const EFS_STORAGE_USAGE_TYPES: Readonly<Record<string, string>> = {
  'General Purpose': 'TimedStorage-ByteHrs',
  'Infrequent Access': 'IATimedStorage-ByteHrs',
  Archive: 'ArchiveTimedStorage-ByteHrs',
  'One Zone-General Purpose': 'TimedStorage-Z-ByteHrs',
  'One Zone-Infrequent Access': 'IATimedStorage-Z-ByteHrs',
};

const DYNAMODB_IA_TABLE_CLASS = 'STANDARD_INFREQUENT_ACCESS';

function dynamoSide(side: 'READ' | 'WRITE'): 'Read' | 'Write' {
  return side === 'READ' ? 'Read' : 'Write';
}

/**
 * Price List filters per query kind. Attribute names and values were verified against live
 * GetProducts responses (us-east-1, 2026-11); see docs/architecture/extended-services.md section 4.
 */
export function querySpec(q: PriceQuery): QuerySpec {
  switch (q.kind) {
    case 'EC2_INSTANCE_HOURLY':
      return {
        serviceCode: 'AmazonEC2',
        filters: {
          regionCode: q.region,
          instanceType: q.instanceType,
          operatingSystem: q.operatingSystem,
          tenancy: q.tenancy,
          capacitystatus: 'Used',
          preInstalledSw: q.preInstalledSw,
          licenseModel: q.licenseModel,
        },
        usageType: /(^|-)(BoxUsage|DedicatedUsage|HostBoxUsage):/,
        unit: 'Hrs',
        tier: 'first',
      };
    case 'EBS_STORAGE_GB_MONTH':
      return {
        serviceCode: 'AmazonEC2',
        filters: { regionCode: q.region, productFamily: 'Storage', volumeApiName: q.volumeApiName },
        usageType: /(^|-)EBS:VolumeUsage(\.[\w.]+)?$/,
        unit: 'GB-Mo',
        tier: 'first',
      };
    case 'EBS_SNAPSHOT_GB_MONTH':
      return {
        serviceCode: 'AmazonEC2',
        filters: { regionCode: q.region, productFamily: 'Storage Snapshot' },
        usageType: /(^|-)EBS:SnapshotUsage$/,
        unit: 'GB-Mo',
        tier: 'first',
      };
    case 'PUBLIC_IPV4_IDLE_HOURLY':
      return {
        serviceCode: 'AmazonVPC',
        filters: { regionCode: q.region, group: 'VPCPublicIPv4Address' },
        usageType: /(^|-)PublicIPv4:IdleAddress$/,
        unit: 'Hrs',
        tier: 'first',
      };
    case 'RDS_INSTANCE_HOURLY':
      return {
        serviceCode: 'AmazonRDS',
        filters: {
          regionCode: q.region,
          instanceType: q.instanceClass,
          databaseEngine: q.databaseEngine,
          deploymentOption: q.deploymentOption,
        },
        // InstanceUsage (Single-AZ) / Multi-AZUsage; never UnusedBox (unused capacity reservations).
        usageType: /(^|-)(InstanceUsage|Multi-AZUsage):/,
        unit: 'Hrs',
        tier: 'first',
      };
    case 'NAT_GATEWAY_HOURLY':
      return {
        serviceCode: 'AmazonEC2',
        filters: { regionCode: q.region, productFamily: 'NAT Gateway' },
        usageType: /(^|-)NatGateway-Hours$/,
        unit: 'Hrs',
        tier: 'first',
      };
    case 'LAMBDA_GB_SECOND':
      return {
        serviceCode: 'AWSLambda',
        filters: {
          regionCode: q.region,
          group: q.architecture === 'arm64' ? 'AWS-Lambda-Duration-ARM' : 'AWS-Lambda-Duration',
        },
        usageType: /(^|-)Lambda-GB-Second(-ARM)?$/,
        unit: 'Lambda-GB-Second',
        // Tier 1 is the highest (most conservative) price; volume tiers depend on account-wide usage.
        tier: 'first',
      };
    case 'LAMBDA_PROVISIONED_CONCURRENCY_GB_SECOND':
      return {
        serviceCode: 'AWSLambda',
        filters: {
          regionCode: q.region,
          group:
            q.architecture === 'arm64'
              ? 'AWS-Lambda-Provisioned-Concurrency-ARM'
              : 'AWS-Lambda-Provisioned-Concurrency',
        },
        // The allocation charge, not the duration charge for requests served by provisioned concurrency.
        usageType: /(^|-)Lambda-Provisioned-Concurrency(-ARM)?$/,
        unit: 'Lambda-GB-Second',
        tier: 'first',
      };
    case 'EKS_CLUSTER_HOURLY':
      // STANDARD prices the control plane; EXTENDED prices only the extended-support surcharge, which is billed
      // on top of the control-plane rate. The savings engine sums both lookups for clusters in extended support.
      return {
        serviceCode: 'AmazonEKS',
        filters: { regionCode: q.region },
        usageType: usageSuffix(
          q.supportType === 'EXTENDED' ? 'AmazonEKS-Hours:extendedSupport' : 'AmazonEKS-Hours:perCluster',
        ),
        unit: 'Hours',
        alternateUnits: ['Hrs'],
        tier: 'first',
      };
    case 'ELASTICACHE_NODE_HOURLY':
      return {
        serviceCode: 'AmazonElastiCache',
        filters: { regionCode: q.region, instanceType: q.cacheNodeType, cacheEngine: q.cacheEngine },
        usageType: /^(?:[A-Z]{2,4}\d?-)?NodeUsage:/,
        // Extended-support and sync-durability SKUs share the node type and engine but are different charges.
        excludeUsageType: /ExtendedSupport|SyncDurability/i,
        unit: 'Hrs',
        tier: 'first',
      };
    case 'EFS_STORAGE_GB_MONTH': {
      const known = EFS_STORAGE_USAGE_TYPES[q.storageClass];
      return {
        serviceCode: 'AmazonEFS',
        filters: { regionCode: q.region, productFamily: 'Storage', storageClass: q.storageClass },
        usageType: known ? usageSuffix(known) : /(^|-)(IA|Archive)?TimedStorage(-Z)?-ByteHrs$/,
        // Elastic-throughput (-ET-), small-file and data-access products are not storage GB-month charges.
        excludeUsageType: /(^|-)ET-|SmallFiles|Access/i,
        unit: 'GB-Mo',
        tier: 'first',
      };
    }
    case 'DYNAMODB_PROVISIONED_CAPACITY_HOURLY': {
      const side = dynamoSide(q.capacity);
      const ia = q.tableClass === DYNAMODB_IA_TABLE_CLASS;
      return {
        serviceCode: 'AmazonDynamoDB',
        filters: {
          regionCode: q.region,
          productFamily: 'Provisioned IOPS',
          group: `DDB-${side}Units${ia ? 'IA' : ''}`,
        },
        usageType: new RegExp(`${side}CapacityUnit-Hrs`),
        excludeUsageType: /Repl|Vector/i,
        unit: `${side}CapacityUnit-Hrs`,
        alternateUnits: ['Hrs'],
        // The beginRange "0" row is the $0 Free Tier allowance.
        tier: 'paid',
      };
    }
    case 'DYNAMODB_ON_DEMAND_REQUEST_UNIT': {
      const side = dynamoSide(q.request);
      const ia = q.tableClass === DYNAMODB_IA_TABLE_CLASS;
      return {
        serviceCode: 'AmazonDynamoDB',
        filters: { regionCode: q.region, productFamily: 'Amazon DynamoDB PayPerRequest Throughput' },
        usageType: usageExact(`${ia ? 'IA-' : ''}${side}RequestUnits`),
        // The optional region prefix pattern would also accept "IA-" (us-east-1 has no region prefix).
        excludeUsageType: ia ? /Repl|Vector/i : /(^|-)IA-|Repl|Vector/i,
        unit: `${side}RequestUnits`,
        tier: 'first',
      };
    }
    case 'DYNAMODB_STORAGE_GB_MONTH': {
      const ia = q.tableClass === DYNAMODB_IA_TABLE_CLASS;
      return {
        serviceCode: 'AmazonDynamoDB',
        filters: { regionCode: q.region, productFamily: 'Database Storage' },
        usageType: usageSuffix(ia ? 'IA-TimedStorage-ByteHrs' : 'TimedStorage-ByteHrs'),
        excludeUsageType: ia ? /PITR/i : /(^|-)IA-|PITR/i,
        unit: 'GB-Mo',
        // The beginRange "0" row is the 25 GB-month Free Tier allowance.
        tier: 'paid',
      };
    }
    case 'REDSHIFT_NODE_HOURLY':
      return {
        serviceCode: 'AmazonRedshift',
        filters: { regionCode: q.region, instanceType: q.nodeType, productFamily: 'Compute Instance' },
        usageType: usageSuffix(`Node:${q.nodeType}`),
        unit: 'Hrs',
        tier: 'first',
      };
  }
}

export type PriceDimension = {
  unit?: string;
  pricePerUnit?: Record<string, string>;
  description?: string;
  beginRange?: string;
};

interface PriceListDocument {
  product?: { sku?: string; attributes?: Record<string, string> };
  terms?: {
    OnDemand?: Record<string, { effectiveDate?: string; priceDimensions?: Record<string, PriceDimension> }>;
  };
}

interface Candidate {
  sku: string | null;
  usageType: string;
  unitPriceUsd: number;
  unit: string;
  description: string | null;
  effectiveDate: string | null;
}

function unitMatches(spec: QuerySpec, unit: string | undefined): boolean {
  const actual = (unit ?? '').toLowerCase();
  return [spec.unit, ...(spec.alternateUnits ?? [])].some((u) => u.toLowerCase() === actual);
}

function usdOf(dim: PriceDimension): number {
  return Number.parseFloat(dim.pricePerUnit?.USD ?? '');
}

function beginRangeOf(dim: PriceDimension): number {
  const begin = Number.parseFloat(dim.beginRange ?? '0');
  return Number.isFinite(begin) ? begin : 0;
}

/**
 * Applies the spec's tier strategy to the price dimensions of one on-demand term (already filtered by unit and
 * to finite, non-negative prices). `first` may return several dimensions (all beginRange "0"); `paid` at most one.
 */
export function selectTierDimensions<T extends PriceDimension>(dims: readonly T[], tier: TierStrategy): T[] {
  if (tier === 'first') return dims.filter((d) => d.beginRange === undefined || d.beginRange === '0');
  let best: T | undefined;
  for (const dim of dims) {
    if (!(usdOf(dim) > 0)) continue;
    if (!best || beginRangeOf(dim) > beginRangeOf(best)) best = dim;
  }
  return best ? [best] : [];
}

export function extractCandidates(documents: readonly PriceListDocument[], spec: QuerySpec): Candidate[] {
  const out: Candidate[] = [];
  for (const doc of documents) {
    const usageType = doc.product?.attributes?.usagetype ?? '';
    if (!spec.usageType.test(usageType)) continue;
    if (spec.excludeUsageType?.test(usageType)) continue;
    for (const term of Object.values(doc.terms?.OnDemand ?? {})) {
      const usable = Object.values(term.priceDimensions ?? {}).filter((dim) => {
        const usd = usdOf(dim);
        return unitMatches(spec, dim.unit) && Number.isFinite(usd) && usd >= 0;
      });
      for (const dim of selectTierDimensions(usable, spec.tier)) {
        out.push({
          sku: doc.product?.sku ?? null,
          usageType,
          unitPriceUsd: usdOf(dim),
          unit: dim.unit ?? spec.unit,
          description: dim.description ?? null,
          effectiveDate: term.effectiveDate ?? null,
        });
      }
    }
  }
  return out;
}

export interface AwsPriceListProviderOptions {
  retry?: Pick<RetryOptions, 'maxAttempts' | 'baseDelayMs' | 'maxDelayMs'>;
  maxPages?: number;
  clock?: () => Date;
}

/** PriceProvider backed by the AWS Price List Query API (pricing:GetProducts) using CloudSentry's own role. */
export class AwsPriceListProvider implements PriceProvider {
  constructor(
    private readonly client: PricingClient,
    private readonly logger: Logger,
    private readonly options: AwsPriceListProviderOptions = {},
  ) {}

  private async fetchDocuments(spec: QuerySpec): Promise<PriceListDocument[]> {
    const docs: PriceListDocument[] = [];
    let nextToken: string | undefined;
    const maxPages = this.options.maxPages ?? 20;
    for (let page = 0; page < maxPages; page++) {
      const out: GetProductsCommandOutput = await withRetry(
        () =>
          this.client.send(
            new GetProductsCommand({
              ServiceCode: spec.serviceCode,
              FormatVersion: 'aws_v1',
              MaxResults: 100,
              NextToken: nextToken,
              Filters: Object.entries(spec.filters).map(([Field, Value]) => ({
                Type: 'TERM_MATCH',
                Field,
                Value,
              })),
            }),
          ),
        { maxAttempts: 3, baseDelayMs: 300, ...this.options.retry },
      );
      for (const item of out.PriceList ?? []) docs.push(JSON.parse(String(item)) as PriceListDocument);
      nextToken = out.NextToken;
      if (!nextToken) return docs;
    }
    this.logger.warn('Price List pagination limit reached', { serviceCode: spec.serviceCode, maxPages });
    return docs;
  }

  async getPrice(query: PriceQuery): Promise<PriceLookupResult> {
    const spec = querySpec(query);
    let documents: PriceListDocument[];
    try {
      documents = await this.fetchDocuments(spec);
    } catch (error) {
      const name = awsErrorName(error) ?? 'Error';
      this.logger.warn('Price List API request failed', {
        kind: query.kind,
        region: query.region,
        awsError: name,
      });
      return {
        query,
        price: null,
        unavailableReason: `${PRICE_UNAVAILABLE.API_ERROR}: ${name}: ${errorMessage(error)}`,
      };
    }
    const candidates = extractCandidates(documents, spec);
    if (candidates.length === 0) {
      return {
        query,
        price: null,
        unavailableReason: `${PRICE_UNAVAILABLE.NO_MATCH}: no on-demand ${spec.unit} price${spec.tier === 'paid' ? ' (paid tier)' : ''} found in the AWS Price List for ${describeQuery(query)}`,
      };
    }
    const distinct = new Set(candidates.map((c) => c.unitPriceUsd));
    if (distinct.size > 1) {
      return {
        query,
        price: null,
        unavailableReason: `${PRICE_UNAVAILABLE.AMBIGUOUS}: ${distinct.size} different prices matched ${describeQuery(query)} (${candidates
          .map((c) => c.usageType)
          .join(', ')})`,
      };
    }
    const chosen = [...candidates].sort((a, b) => (a.sku ?? '').localeCompare(b.sku ?? ''))[0] as Candidate;
    const price: PricePoint = {
      unitPriceUsd: chosen.unitPriceUsd,
      unit: chosen.unit,
      sku: chosen.sku,
      description: chosen.description,
      effectiveDate: chosen.effectiveDate,
      source: 'AWS_PRICE_LIST_API',
      retrievedAt: (this.options.clock?.() ?? new Date()).toISOString(),
    };
    return { query, price };
  }
}

export function describeQuery(query: PriceQuery): string {
  const { kind, ...rest } = query;
  return `${kind} ${Object.entries(rest)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ')}`;
}
