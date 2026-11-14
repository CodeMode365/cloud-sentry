import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetProductsCommand, PricingClient } from '@aws-sdk/client-pricing';
import type { PriceLookupResult, PriceQuery } from '@cloudsentry/shared-types';
import { silentLogger } from '@cloudsentry/utilities';
import { priceListEntry, simpleEntry } from '../__fixtures__/price-list';
import {
  AwsPriceListProvider,
  extractCandidates,
  querySpec,
  selectTierDimensions,
  type PriceDimension,
} from './aws-price-list';

const pricingMock = mockClient(PricingClient);
const provider = () =>
  new AwsPriceListProvider(new PricingClient({ region: 'us-east-1' }), silentLogger, {
    retry: { baseDelayMs: 1, maxDelayMs: 2 },
    clock: () => new Date('2026-11-14T00:00:00Z'),
  });

beforeEach(() => pricingMock.reset());

/** Serves the same documents for every GetProducts call (the usage-type patterns do the selecting). */
function serve(...entries: string[]) {
  pricingMock.on(GetProductsCommand).resolves({ PriceList: entries });
}

function filtersOf(call = 0): Record<string, string> {
  const input = pricingMock.commandCalls(GetProductsCommand)[call]?.args[0].input;
  return Object.fromEntries((input?.Filters ?? []).map((f) => [f.Field ?? '', f.Value ?? '']));
}

function serviceCodeOf(call = 0): string | undefined {
  return pricingMock.commandCalls(GetProductsCommand)[call]?.args[0].input.ServiceCode;
}

async function price(query: PriceQuery): Promise<PriceLookupResult> {
  return provider().getPrice(query);
}

// Lambda x86_64 duration: three volume tiers; tier 1 (beginRange 0) is the highest price.
const LAMBDA_X86 = priceListEntry({
  sku: 'LX86',
  usagetype: 'Lambda-GB-Second',
  productFamily: 'Serverless',
  attributes: { group: 'AWS-Lambda-Duration' },
  dimensions: [
    { usd: '0.0000166667', unit: 'Lambda-GB-Second', beginRange: '0', endRange: '6000000000' },
    { usd: '0.0000150000', unit: 'Lambda-GB-Second', beginRange: '6000000000', endRange: '15000000000' },
    { usd: '0.0000133334', unit: 'Lambda-GB-Second', beginRange: '15000000000' },
  ],
});

// DynamoDB provisioned read capacity: the beginRange 0 row is the $0 Free Tier allowance.
function ddbCapacity(sku: string, usagetype: string, usd: string, unit: string, group: string): string {
  return priceListEntry({
    sku,
    usagetype,
    productFamily: 'Provisioned IOPS',
    attributes: { group, operation: 'CommittedThroughput' },
    dimensions: [
      {
        usd: '0.0000000000',
        unit,
        beginRange: '0',
        endRange: '18600',
        description: '$0.00 per hour for 25 units of capacity for a month (free tier)',
      },
      { usd, unit, beginRange: '18600', description: `$${usd} per hour beyond the free tier` },
    ],
  });
}

function ddbStorage(sku: string, usagetype: string, usd: string): string {
  return priceListEntry({
    sku,
    usagetype,
    productFamily: 'Database Storage',
    dimensions: [
      { usd: '0.0000000000', unit: 'GB-Mo', beginRange: '0', endRange: '25', description: 'free tier' },
      { usd, unit: 'GB-Mo', beginRange: '25' },
    ],
  });
}

describe('querySpec for extended services', () => {
  it.each<[string, PriceQuery, string, Record<string, string>, 'first' | 'paid']>([
    [
      'Lambda x86_64',
      { kind: 'LAMBDA_GB_SECOND', region: 'us-east-1', architecture: 'x86_64' },
      'AWSLambda',
      { regionCode: 'us-east-1', group: 'AWS-Lambda-Duration' },
      'first',
    ],
    [
      'Lambda arm64',
      { kind: 'LAMBDA_GB_SECOND', region: 'us-east-1', architecture: 'arm64' },
      'AWSLambda',
      { regionCode: 'us-east-1', group: 'AWS-Lambda-Duration-ARM' },
      'first',
    ],
    [
      'Lambda provisioned concurrency arm64',
      { kind: 'LAMBDA_PROVISIONED_CONCURRENCY_GB_SECOND', region: 'us-east-1', architecture: 'arm64' },
      'AWSLambda',
      { regionCode: 'us-east-1', group: 'AWS-Lambda-Provisioned-Concurrency-ARM' },
      'first',
    ],
    [
      'EKS',
      { kind: 'EKS_CLUSTER_HOURLY', region: 'us-east-1', supportType: 'STANDARD' },
      'AmazonEKS',
      { regionCode: 'us-east-1' },
      'first',
    ],
    [
      'ElastiCache',
      {
        kind: 'ELASTICACHE_NODE_HOURLY',
        region: 'us-east-1',
        cacheNodeType: 'cache.r6g.large',
        cacheEngine: 'Valkey',
      },
      'AmazonElastiCache',
      { regionCode: 'us-east-1', instanceType: 'cache.r6g.large', cacheEngine: 'Valkey' },
      'first',
    ],
    [
      'EFS',
      { kind: 'EFS_STORAGE_GB_MONTH', region: 'us-east-1', storageClass: 'Infrequent Access' },
      'AmazonEFS',
      { regionCode: 'us-east-1', productFamily: 'Storage', storageClass: 'Infrequent Access' },
      'first',
    ],
    [
      'DynamoDB provisioned IA write',
      {
        kind: 'DYNAMODB_PROVISIONED_CAPACITY_HOURLY',
        region: 'us-east-1',
        capacity: 'WRITE',
        tableClass: 'STANDARD_INFREQUENT_ACCESS',
      },
      'AmazonDynamoDB',
      { regionCode: 'us-east-1', productFamily: 'Provisioned IOPS', group: 'DDB-WriteUnitsIA' },
      'paid',
    ],
    [
      'DynamoDB on-demand',
      {
        kind: 'DYNAMODB_ON_DEMAND_REQUEST_UNIT',
        region: 'us-east-1',
        request: 'READ',
        tableClass: 'STANDARD',
      },
      'AmazonDynamoDB',
      { regionCode: 'us-east-1', productFamily: 'Amazon DynamoDB PayPerRequest Throughput' },
      'first',
    ],
    [
      'DynamoDB storage',
      { kind: 'DYNAMODB_STORAGE_GB_MONTH', region: 'us-east-1', tableClass: 'STANDARD' },
      'AmazonDynamoDB',
      { regionCode: 'us-east-1', productFamily: 'Database Storage' },
      'paid',
    ],
    [
      'Redshift',
      { kind: 'REDSHIFT_NODE_HOURLY', region: 'us-east-1', nodeType: 'ra3.xlplus' },
      'AmazonRedshift',
      { regionCode: 'us-east-1', instanceType: 'ra3.xlplus', productFamily: 'Compute Instance' },
      'first',
    ],
  ])('%s', (_name, query, serviceCode, filters, tier) => {
    const spec = querySpec(query);
    expect(spec.serviceCode).toBe(serviceCode);
    expect(spec.filters).toEqual(filters);
    expect(spec.tier).toBe(tier);
  });

  it('uses the first tier for every pre-existing kind', () => {
    expect(querySpec({ kind: 'NAT_GATEWAY_HOURLY', region: 'us-east-1' }).tier).toBe('first');
    expect(querySpec({ kind: 'EBS_SNAPSHOT_GB_MONTH', region: 'us-east-1' }).tier).toBe('first');
  });

  it('tolerates region prefixes and escapes node types in usage-type patterns', () => {
    const redshift = querySpec({ kind: 'REDSHIFT_NODE_HOURLY', region: 'us-west-2', nodeType: 'ra3.xlplus' });
    expect(redshift.usageType.test('USW2-Node:ra3.xlplus')).toBe(true);
    expect(redshift.usageType.test('Node:ra3.xlplus')).toBe(true);
    expect(redshift.usageType.test('Node:ra3Xxlplus')).toBe(false);
    const eks = querySpec({ kind: 'EKS_CLUSTER_HOURLY', region: 'us-west-2', supportType: 'EXTENDED' });
    expect(eks.usageType.test('USW2-AmazonEKS-Hours:extendedSupport')).toBe(true);
    expect(eks.usageType.test('USW2-AmazonEKS-Hours:perCluster')).toBe(false);
  });
});

describe('selectTierDimensions', () => {
  const dims: PriceDimension[] = [
    { unit: 'GB-Mo', beginRange: '0', pricePerUnit: { USD: '0.0000000000' } },
    { unit: 'GB-Mo', beginRange: '25', pricePerUnit: { USD: '0.2500000000' } },
  ];

  it('first: keeps the beginRange 0 (or unranged) dimension', () => {
    expect(selectTierDimensions(dims, 'first')).toEqual([dims[0]]);
    expect(selectTierDimensions([{ pricePerUnit: { USD: '1' } }], 'first')).toHaveLength(1);
  });

  it('paid: picks the highest beginRange with a price above zero', () => {
    expect(selectTierDimensions(dims, 'paid')).toEqual([dims[1]]);
    const three: PriceDimension[] = [
      { beginRange: '0', pricePerUnit: { USD: '0' } },
      { beginRange: '1000', pricePerUnit: { USD: '0.2' } },
      { beginRange: '5000', pricePerUnit: { USD: '0.1' } },
      { beginRange: '9000', pricePerUnit: { USD: '0' } },
    ];
    expect(selectTierDimensions(three, 'paid')).toEqual([three[2]]);
  });

  it('paid: returns nothing when every dimension is free', () => {
    expect(selectTierDimensions([dims[0] as PriceDimension], 'paid')).toEqual([]);
  });

  it('the strategy changes the extracted price for a free-tier product', () => {
    const doc = JSON.parse(ddbStorage('S', 'TimedStorage-ByteHrs', '0.2500000000'));
    const spec = querySpec({
      kind: 'DYNAMODB_STORAGE_GB_MONTH',
      region: 'us-east-1',
      tableClass: 'STANDARD',
    });
    expect(extractCandidates([doc], spec).map((c) => c.unitPriceUsd)).toEqual([0.25]);
    expect(extractCandidates([doc], { ...spec, tier: 'first' }).map((c) => c.unitPriceUsd)).toEqual([0]);
  });
});

describe('AwsPriceListProvider for extended services', () => {
  it('Lambda duration uses tier 1 of the x86_64 group', async () => {
    serve(LAMBDA_X86);
    const result = await price({ kind: 'LAMBDA_GB_SECOND', region: 'us-east-1', architecture: 'x86_64' });
    expect(result.price).toMatchObject({ unitPriceUsd: 0.0000166667, unit: 'Lambda-GB-Second', sku: 'LX86' });
    expect(serviceCodeOf()).toBe('AWSLambda');
  });

  it('Lambda arm64 duration matches a region-prefixed usage type', async () => {
    serve(
      priceListEntry({
        sku: 'LARM',
        usagetype: 'USW2-Lambda-GB-Second-ARM',
        attributes: { group: 'AWS-Lambda-Duration-ARM', regionCode: 'us-west-2' },
        dimensions: [
          { usd: '0.0000133334', unit: 'Lambda-GB-Second', beginRange: '0', endRange: '7500000000' },
          { usd: '0.0000120001', unit: 'Lambda-GB-Second', beginRange: '7500000000' },
        ],
      }),
    );
    const result = await price({ kind: 'LAMBDA_GB_SECOND', region: 'us-west-2', architecture: 'arm64' });
    expect(result.price?.unitPriceUsd).toBe(0.0000133334);
    expect(filtersOf()).toMatchObject({ regionCode: 'us-west-2', group: 'AWS-Lambda-Duration-ARM' });
  });

  it('Lambda provisioned concurrency prices the allocation, not provisioned duration', async () => {
    serve(
      simpleEntry('PC', 'Lambda-Provisioned-Concurrency', 'Lambda-GB-Second', '0.0000041667'),
      simpleEntry('PD', 'Lambda-Provisioned-GB-Second', 'Lambda-GB-Second', '0.0000097222'),
    );
    const result = await price({
      kind: 'LAMBDA_PROVISIONED_CONCURRENCY_GB_SECOND',
      region: 'us-east-1',
      architecture: 'x86_64',
    });
    expect(result.price).toMatchObject({ sku: 'PC', unitPriceUsd: 0.0000041667 });
  });

  it('Lambda arm64 provisioned concurrency is unavailable when the ARM group has no products', async () => {
    serve();
    const result = await price({
      kind: 'LAMBDA_PROVISIONED_CONCURRENCY_GB_SECOND',
      region: 'us-east-1',
      architecture: 'arm64',
    });
    expect(result.price).toBeNull();
    expect(result.unavailableReason).toMatch(/^NO_MATCHING_PRICE/);
  });

  describe('EKS', () => {
    const eksDocs = [
      simpleEntry('CP', 'USE1-AmazonEKS-Hours:perCluster', 'Hours', '0.1000000000'),
      simpleEntry('EX', 'USE1-AmazonEKS-Hours:extendedSupport', 'Hours', '0.5000000000'),
      simpleEntry('OP', 'USE1-AmazonEKS-Hours:perOutpostsCluster', 'Hours', '0.1000000000'),
      simpleEntry('HY', 'USE1-AmazonEKS-Hours:HybridNodes', 'vCPU-Hours', '0.0200000000'),
    ];

    it('prices the control plane and the extended-support surcharge separately', async () => {
      serve(...eksDocs);
      const standard = await price({
        kind: 'EKS_CLUSTER_HOURLY',
        region: 'us-east-1',
        supportType: 'STANDARD',
      });
      const extended = await price({
        kind: 'EKS_CLUSTER_HOURLY',
        region: 'us-east-1',
        supportType: 'EXTENDED',
      });
      expect(standard.price).toMatchObject({ sku: 'CP', unitPriceUsd: 0.1, unit: 'Hours' });
      expect(extended.price).toMatchObject({ sku: 'EX', unitPriceUsd: 0.5 });
      expect(serviceCodeOf()).toBe('AmazonEKS');
    });
  });

  describe('ElastiCache', () => {
    const query = {
      kind: 'ELASTICACHE_NODE_HOURLY' as const,
      region: 'us-east-1',
      cacheNodeType: 'cache.r6g.large',
      cacheEngine: 'Redis',
    };

    it('selects NodeUsage and ignores extended-support and sync-durability decoys', async () => {
      serve(
        simpleEntry('N', 'NodeUsage:cache.r6g.large', 'Hrs', '0.2060000000', { cacheEngine: 'Redis' }),
        simpleEntry('E1', 'NodeUsage:cache.r6g.large:ExtendedSupport-Yr1-Yr2', 'Hrs', '0.1648000000'),
        simpleEntry('E2', 'ExtendedSupportNodeUsage:cache.r6g.large', 'Hrs', '0.1648000000'),
        simpleEntry('SD', 'NodeUsage:cache.r6g.large:SyncDurability', 'Hrs', '0.2884000000'),
      );
      const result = await price(query);
      expect(result.price).toMatchObject({ sku: 'N', unitPriceUsd: 0.206 });
      expect(filtersOf()).toMatchObject({ instanceType: 'cache.r6g.large', cacheEngine: 'Redis' });
    });

    it('matches region-prefixed node usage', async () => {
      serve(
        simpleEntry('N', 'USW2-NodeUsage:cache.r6g.large', 'Hrs', '0.1648000000'),
        simpleEntry('SD', 'USW2-NodeUsage:cache.r6g.large-SyncDurability', 'Hrs', '0.2000000000'),
      );
      const result = await price({ ...query, region: 'us-west-2', cacheEngine: 'Valkey' });
      expect(result.price).toMatchObject({ sku: 'N', unitPriceUsd: 0.1648 });
    });
  });

  describe('EFS', () => {
    const efsDocs = (prefix = '') => [
      simpleEntry('STD', `${prefix}TimedStorage-ByteHrs`, 'GB-Mo', '0.3000000000'),
      simpleEntry('ET', `${prefix}ET-TimedStorage-ByteHrs`, 'GB-Mo', '0.3300000000'),
      simpleEntry('SF', `${prefix}SmallFiles-TimedStorage-ByteHrs`, 'GB-Mo', '0.3100000000'),
      simpleEntry('IA', `${prefix}IATimedStorage-ByteHrs`, 'GB-Mo', '0.0250000000'),
      simpleEntry('IASF', `${prefix}IASmallFiles-IATimedStorage-ByteHrs`, 'GB-Mo', '0.0300000000'),
      simpleEntry('IAAC', `${prefix}IADataAccess-IATimedStorage-ByteHrs`, 'GB-Mo', '0.0100000000'),
      simpleEntry('IAREAD', `${prefix}IADataAccess-Bytes`, 'GB', '0.0100000000'),
      simpleEntry('AR', `${prefix}ArchiveTimedStorage-ByteHrs`, 'GB-Mo', '0.0080000000'),
      simpleEntry('Z', `${prefix}TimedStorage-Z-ByteHrs`, 'GB-Mo', '0.1600000000'),
      simpleEntry('ZIA', `${prefix}IATimedStorage-Z-ByteHrs`, 'GB-Mo', '0.0133000000'),
    ];

    it.each<[string, string, number]>([
      ['General Purpose', 'STD', 0.3],
      ['Infrequent Access', 'IA', 0.025],
      ['Archive', 'AR', 0.008],
      ['One Zone-General Purpose', 'Z', 0.16],
      ['One Zone-Infrequent Access', 'ZIA', 0.0133],
    ])('%s storage ignores -ET-, SmallFiles and access decoys', async (storageClass, sku, usd) => {
      serve(...efsDocs());
      const result = await price({ kind: 'EFS_STORAGE_GB_MONTH', region: 'us-east-1', storageClass });
      expect(result.price).toMatchObject({ sku, unitPriceUsd: usd, unit: 'GB-Mo' });
    });

    it('matches region-prefixed usage types', async () => {
      serve(...efsDocs('USW2-'));
      const result = await price({
        kind: 'EFS_STORAGE_GB_MONTH',
        region: 'us-west-2',
        storageClass: 'General Purpose',
      });
      expect(result.price?.sku).toBe('STD');
    });
  });

  describe('DynamoDB', () => {
    it('provisioned capacity skips the $0 free-tier row (paid tier)', async () => {
      serve(
        ddbCapacity('R', 'ReadCapacityUnit-Hrs', '0.0001300000', 'ReadCapacityUnit-Hrs', 'DDB-ReadUnits'),
      );
      const result = await price({
        kind: 'DYNAMODB_PROVISIONED_CAPACITY_HOURLY',
        region: 'us-east-1',
        capacity: 'READ',
        tableClass: 'STANDARD',
      });
      expect(result.price).toMatchObject({ sku: 'R', unitPriceUsd: 0.00013 });
      expect(filtersOf()).toEqual({
        regionCode: 'us-east-1',
        productFamily: 'Provisioned IOPS',
        group: 'DDB-ReadUnits',
      });
    });

    it('provisioned write capacity (IA, region-prefixed) ignores replicated-write decoys', async () => {
      serve(
        ddbCapacity(
          'W',
          'USW2-IA-WriteCapacityUnit-Hrs',
          '0.0008100000',
          'WriteCapacityUnit-Hrs',
          'DDB-WriteUnitsIA',
        ),
        ddbCapacity(
          'RW',
          'USW2-IA-ReplWriteCapacityUnit-Hrs',
          '0.0012200000',
          'WriteCapacityUnit-Hrs',
          'DDB-WriteUnitsIA',
        ),
      );
      const result = await price({
        kind: 'DYNAMODB_PROVISIONED_CAPACITY_HOURLY',
        region: 'us-west-2',
        capacity: 'WRITE',
        tableClass: 'STANDARD_INFREQUENT_ACCESS',
      });
      expect(result.price).toMatchObject({ sku: 'W', unitPriceUsd: 0.00081 });
    });

    it('is ambiguous when two paid-tier products disagree, and unavailable when only free rows exist', async () => {
      serve(
        ddbCapacity('A', 'ReadCapacityUnit-Hrs', '0.0001300000', 'ReadCapacityUnit-Hrs', 'DDB-ReadUnits'),
        ddbCapacity('B', 'ReadCapacityUnit-Hrs', '0.0001400000', 'ReadCapacityUnit-Hrs', 'DDB-ReadUnits'),
      );
      const query = {
        kind: 'DYNAMODB_PROVISIONED_CAPACITY_HOURLY' as const,
        region: 'us-east-1',
        capacity: 'READ' as const,
        tableClass: 'STANDARD',
      };
      const ambiguous = await price(query);
      expect(ambiguous.price).toBeNull();
      expect(ambiguous.unavailableReason).toMatch(/^AMBIGUOUS_PRICE/);

      pricingMock.reset();
      serve(simpleEntry('F', 'ReadCapacityUnit-Hrs', 'ReadCapacityUnit-Hrs', '0.0000000000'));
      const free = await price(query);
      expect(free.price).toBeNull();
      expect(free.unavailableReason).toMatch(/^NO_MATCHING_PRICE: .*\(paid tier\)/);
    });

    describe('on-demand request units', () => {
      const docs = [
        simpleEntry('RRU', 'ReadRequestUnits', 'ReadRequestUnits', '0.0000001250'),
        simpleEntry('WRU', 'WriteRequestUnits', 'WriteRequestUnits', '0.0000006250'),
        simpleEntry('IARRU', 'IA-ReadRequestUnits', 'ReadRequestUnits', '0.0000001550'),
        simpleEntry('IAWRU', 'IA-WriteRequestUnits', 'WriteRequestUnits', '0.0000007750'),
        simpleEntry('REPL', 'ReplWriteRequestUnits', 'WriteRequestUnits', '0.0000009375'),
        simpleEntry('VEC', 'Vector-WriteRequestUnits', 'WriteRequestUnits', '0.0000010000'),
      ];

      it.each<['READ' | 'WRITE', string, string, number]>([
        ['READ', 'STANDARD', 'RRU', 0.000000125],
        ['WRITE', 'STANDARD', 'WRU', 0.000000625],
        ['READ', 'STANDARD_INFREQUENT_ACCESS', 'IARRU', 0.000000155],
        ['WRITE', 'STANDARD_INFREQUENT_ACCESS', 'IAWRU', 0.000000775],
      ])('%s %s', async (request, tableClass, sku, usd) => {
        serve(...docs);
        const result = await price({
          kind: 'DYNAMODB_ON_DEMAND_REQUEST_UNIT',
          region: 'us-east-1',
          request,
          tableClass,
        });
        expect(result.price).toMatchObject({ sku, unitPriceUsd: usd });
      });

      it('matches region-prefixed usage types without mixing IA', async () => {
        serve(
          simpleEntry('RRU', 'USW2-ReadRequestUnits', 'ReadRequestUnits', '0.0000001250'),
          simpleEntry('IARRU', 'USW2-IA-ReadRequestUnits', 'ReadRequestUnits', '0.0000001550'),
        );
        const result = await price({
          kind: 'DYNAMODB_ON_DEMAND_REQUEST_UNIT',
          region: 'us-west-2',
          request: 'READ',
          tableClass: 'STANDARD',
        });
        expect(result.price?.sku).toBe('RRU');
      });
    });

    it.each<[string, string, number]>([
      ['STANDARD', 'S', 0.25],
      ['STANDARD_INFREQUENT_ACCESS', 'IA', 0.1],
    ])('storage %s uses the paid tier and ignores PITR and IA decoys', async (tableClass, sku, usd) => {
      serve(
        ddbStorage('S', 'TimedStorage-ByteHrs', '0.2500000000'),
        ddbStorage('IA', 'IA-TimedStorage-ByteHrs', '0.1000000000'),
        simpleEntry('PITR', 'PITR-TimedStorage-ByteHrs', 'GB-Mo', '0.2000000000'),
        simpleEntry('PITR2', 'TimedPITRStorage-ByteHrs', 'GB-Mo', '0.2000000000'),
        simpleEntry('BK', 'TimedBackupStorage-ByteHrs', 'GB-Mo', '0.1000000000'),
      );
      const result = await price({ kind: 'DYNAMODB_STORAGE_GB_MONTH', region: 'us-east-1', tableClass });
      expect(result.price).toMatchObject({ sku, unitPriceUsd: usd });
    });
  });

  it('Redshift selects the node usage type for the node type', async () => {
    serve(
      simpleEntry('N', 'Node:ra3.xlplus', 'Hrs', '1.0860000000'),
      simpleEntry('MAZ', 'Node:ra3.xlplus-MultiAZ', 'Hrs', '2.1720000000'),
      simpleEntry('RMS', 'RMS:ra3.xlplus', 'GB-Mo', '0.0240000000'),
    );
    const result = await price({ kind: 'REDSHIFT_NODE_HOURLY', region: 'us-east-1', nodeType: 'ra3.xlplus' });
    expect(result.price).toMatchObject({ sku: 'N', unitPriceUsd: 1.086, unit: 'Hrs' });
    expect(serviceCodeOf()).toBe('AmazonRedshift');
  });
});
