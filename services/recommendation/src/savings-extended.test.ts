import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetProductsCommand, PricingClient } from '@aws-sdk/client-pricing';
import {
  ARTIFACT_KEYS,
  type ArtifactEnvelope,
  type PricedRecommendationDraft,
  type SavingsRequest,
} from '@cloudsentry/shared-types';
import { silentLogger } from '@cloudsentry/utilities';
import {
  baseState,
  DEFAULT_FAKE_PRICES,
  envelope,
  FakePriceProvider,
  issue,
  MemoryArtifacts,
  NOW,
  PREFIX,
} from './__fixtures__/issues';
import { priceListEntry, simpleEntry } from './__fixtures__/price-list';
import { generateRecommendations } from './generate';
import { AwsPriceListProvider } from './pricing/aws-price-list';
import { estimateRequestSavings } from './savings';
import { runEstimateSavingsStep } from './step-savings';

const R = 'us-east-1';

describe('estimateRequestSavings (extended services)', () => {
  it.each<[string, SavingsRequest, number, 'POINT' | 'UPPER_BOUND', number]>([
    [
      // (1024 - 256) / 1024 x 10,000,000 s x 0.0000166667
      'Lambda memory rightsize',
      {
        kind: 'LAMBDA_MEMORY_RIGHTSIZE',
        region: R,
        architecture: 'x86_64',
        currentMemoryMb: 1024,
        recommendedMemoryMb: 256,
        monthlyDurationSeconds: 10_000_000,
      },
      125,
      'UPPER_BOUND',
      1,
    ],
    [
      // 2048 / 1024 x 5,000,000 s x (0.0000166667 - 0.0000133334)
      'Lambda arm64 migration',
      { kind: 'LAMBDA_ARM64_MIGRATION', region: R, memoryMb: 2048, monthlyDurationSeconds: 5_000_000 },
      33.33,
      'POINT',
      2,
    ],
    [
      // 45 x 1024 / 1024 x 730 x 3600 x 0.0000041667
      'Lambda provisioned concurrency',
      {
        kind: 'LAMBDA_PROVISIONED_CONCURRENCY_REDUCE',
        region: R,
        architecture: 'x86_64',
        memoryMb: 1024,
        currentAllocated: 50,
        recommendedAllocated: 5,
      },
      492.75,
      'POINT',
      1,
    ],
    ['EKS delete (standard)', { kind: 'EKS_CLUSTER_DELETE', region: R, supportType: 'STANDARD' }, 73, 'POINT', 1],
    // (0.10 + 0.50) x 730: two lookups summed
    ['EKS delete (extended)', { kind: 'EKS_CLUSTER_DELETE', region: R, supportType: 'EXTENDED' }, 438, 'POINT', 2],
    [
      // 3 x 0.0832 x 730
      'EKS nodes reduce',
      {
        kind: 'EKS_NODES_REDUCE',
        region: R,
        instanceType: 't3.large',
        operatingSystem: 'Linux',
        capacityType: 'ON_DEMAND',
        removableNodes: 3,
      },
      182.21,
      'UPPER_BOUND',
      1,
    ],
    [
      // (0.411 - 0.206) x 2 x 730
      'ElastiCache rightsize',
      {
        kind: 'ELASTICACHE_RIGHTSIZE',
        region: R,
        cacheEngine: 'Redis',
        currentNodeType: 'cache.r6g.xlarge',
        targetNodeType: 'cache.r6g.large',
        numNodes: 2,
      },
      299.3,
      'POINT',
      2,
    ],
    [
      // 0.1648 x 3 x 730
      'ElastiCache delete (Valkey)',
      { kind: 'ELASTICACHE_DELETE', region: R, cacheEngine: 'Valkey', cacheNodeType: 'cache.r6g.large', numNodes: 3 },
      360.91,
      'POINT',
      1,
    ],
    [
      'ElastiCache delete (Memcached)',
      { kind: 'ELASTICACHE_DELETE', region: R, cacheEngine: 'Memcached', cacheNodeType: 'cache.t3.micro', numNodes: 1 },
      12.41,
      'POINT',
      1,
    ],
    [
      // 100 x 0.30 + 200 x 0.025 + 1000 x 0.008
      'EFS delete (regional)',
      { kind: 'EFS_DELETE', region: R, standardGb: 100, infrequentAccessGb: 200, archiveGb: 1000, oneZone: false },
      43,
      'POINT',
      3,
    ],
    [
      // 100 x 0.16 + 100 x 0.0133
      'EFS delete (One Zone)',
      { kind: 'EFS_DELETE', region: R, standardGb: 100, infrequentAccessGb: 100, archiveGb: 0, oneZone: true },
      17.33,
      'POINT',
      2,
    ],
    [
      // 500 x (0.30 - 0.025)
      'EFS lifecycle to IA',
      { kind: 'EFS_LIFECYCLE_TO_IA', region: R, standardGb: 500, oneZone: false },
      137.5,
      'UPPER_BOUND',
      2,
    ],
    [
      // 500 x (0.16 - 0.0133)
      'EFS lifecycle to IA (One Zone)',
      { kind: 'EFS_LIFECYCLE_TO_IA', region: R, standardGb: 500, oneZone: true },
      73.35,
      'UPPER_BOUND',
      2,
    ],
    [
      // (800 x 0.00013 + 400 x 0.00065) x 730
      'DynamoDB rightsize provisioned',
      {
        kind: 'DYNAMODB_RIGHTSIZE_PROVISIONED',
        region: R,
        tableClass: 'STANDARD',
        currentRcu: 1000,
        currentWcu: 500,
        recommendedRcu: 200,
        recommendedWcu: 100,
      },
      265.72,
      'POINT',
      2,
    ],
    [
      // (1000 x 0.00013 + 200 x 0.00065) x 730 - (1e8 x 1.25e-7 + 2e7 x 6.25e-7) = 189.8 - 25
      'DynamoDB switch to on-demand',
      {
        kind: 'DYNAMODB_SWITCH_TO_ON_DEMAND',
        region: R,
        tableClass: 'STANDARD',
        provisionedRcu: 1000,
        provisionedWcu: 200,
        monthlyReadUnits: 100_000_000,
        monthlyWriteUnits: 20_000_000,
      },
      164.8,
      'POINT',
      4,
    ],
    [
      // (10 x 0.00013 + 10 x 0.00065) x 730 + 100 x 0.25
      'DynamoDB delete (provisioned)',
      {
        kind: 'DYNAMODB_DELETE_TABLE',
        region: R,
        tableClass: 'STANDARD',
        billingMode: 'PROVISIONED',
        provisionedRcu: 10,
        provisionedWcu: 10,
        storageGb: 100,
      },
      30.69,
      'POINT',
      3,
    ],
    [
      // 40 x 0.10 (IA storage only)
      'DynamoDB delete (on-demand, IA)',
      {
        kind: 'DYNAMODB_DELETE_TABLE',
        region: R,
        tableClass: 'STANDARD_INFREQUENT_ACCESS',
        billingMode: 'PAY_PER_REQUEST',
        provisionedRcu: 0,
        provisionedWcu: 0,
        storageGb: 40,
      },
      4,
      'POINT',
      1,
    ],
    [
      // 1.086 x 2 x 730
      'Redshift pause (always idle)',
      { kind: 'REDSHIFT_PAUSE', region: R, nodeType: 'ra3.xlplus', numberOfNodes: 2, pausableFraction: 1 },
      1585.56,
      'POINT',
      1,
    ],
    [
      'Redshift pause schedule',
      { kind: 'REDSHIFT_PAUSE', region: R, nodeType: 'ra3.xlplus', numberOfNodes: 2, pausableFraction: 0.5 },
      792.78,
      'UPPER_BOUND',
      1,
    ],
    [
      // 2000 x 0.05
      'Backup retention reduce',
      { kind: 'BACKUP_RETENTION_REDUCE', region: R, ebsGbBeyondRetention: 2000, otherGbBeyondRetention: 300 },
      100,
      'UPPER_BOUND',
      1,
    ],
  ])('%s', async (_name, request, monthly, estimateType, lookups) => {
    const pricing = new FakePriceProvider();
    const est = await estimateRequestSavings(request, pricing, NOW);
    expect(est.status).toBe('ESTIMATED');
    expect(est.monthly).toBe(monthly);
    expect(est.annual).toBeCloseTo(monthly * 12, 1);
    expect(est.estimateType).toBe(estimateType);
    expect(est.pricingSources).toHaveLength(lookups);
    expect(pricing.calls).toHaveLength(lookups);
    expect(est.method).not.toBe('Not calculated');
    expect(est.assumptions.some((a) => a.includes('not a guaranteed'))).toBe(true);
  });

  it('EKS extended support sums the control-plane and surcharge lookups', async () => {
    const pricing = new FakePriceProvider();
    const est = await estimateRequestSavings({ kind: 'EKS_CLUSTER_DELETE', region: R, supportType: 'EXTENDED' }, pricing, NOW);
    expect(pricing.calls.map((c) => c.kind === 'EKS_CLUSTER_HOURLY' && c.supportType)).toEqual(['STANDARD', 'EXTENDED']);
    expect(est.method).toContain('0.1 control plane + 0.5 extended support');
    expect(est.assumptions.some((a) => a.includes('node'))).toBe(true);

    const noSurcharge = new FakePriceProvider({ ...DEFAULT_FAKE_PRICES, 'EKS_CLUSTER_HOURLY:EXTENDED': null });
    const missing = await estimateRequestSavings(
      { kind: 'EKS_CLUSTER_DELETE', region: R, supportType: 'EXTENDED' },
      noSurcharge,
      NOW,
    );
    expect(missing.status).toBe('UNAVAILABLE');
    expect(missing.unavailableReason).toMatch(/^EKS extended support: NO_MATCHING_PRICE/);
  });

  it('EKS nodes are priced with the on-demand EC2 query and are unavailable for SPOT', async () => {
    const base = {
      kind: 'EKS_NODES_REDUCE' as const,
      region: R,
      instanceType: 'm5.large',
      operatingSystem: 'Windows',
      removableNodes: 2,
    };
    const pricing = new FakePriceProvider();
    const unknownCapacity = await estimateRequestSavings({ ...base, capacityType: null }, pricing, NOW);
    expect(unknownCapacity.status).toBe('ESTIMATED');
    expect(unknownCapacity.assumptions.some((a) => a.includes('capacity type is unknown'))).toBe(true);
    expect(pricing.calls[0]).toEqual({
      kind: 'EC2_INSTANCE_HOURLY',
      region: R,
      instanceType: 'm5.large',
      operatingSystem: 'Windows',
      tenancy: 'Shared',
      preInstalledSw: 'NA',
      licenseModel: 'No License required',
    });

    const spot = new FakePriceProvider();
    const est = await estimateRequestSavings({ ...base, capacityType: 'SPOT' }, spot, NOW);
    expect(est.status).toBe('UNAVAILABLE');
    expect(est.unavailableReason).toMatch(/SPOT/);
    expect(spot.calls).toHaveLength(0);
    expect(
      (await estimateRequestSavings({ ...base, capacityType: 'CAPACITY_BLOCK' }, spot, NOW)).status,
    ).toBe('UNAVAILABLE');
    expect((await estimateRequestSavings({ ...base, capacityType: 'ON_DEMAND', removableNodes: 0 }, spot, NOW)).status).toBe(
      'UNAVAILABLE',
    );
  });

  it('DynamoDB switch is UNAVAILABLE when on-demand is not cheaper', async () => {
    const est = await estimateRequestSavings(
      {
        kind: 'DYNAMODB_SWITCH_TO_ON_DEMAND',
        region: R,
        tableClass: 'STANDARD',
        provisionedRcu: 1000,
        provisionedWcu: 200,
        monthlyReadUnits: 2_000_000_000, // 250 USD on-demand vs 189.8 USD provisioned
        monthlyWriteUnits: 0,
      },
      new FakePriceProvider(),
      NOW,
    );
    expect(est).toMatchObject({ status: 'UNAVAILABLE', monthly: null, annual: null });
    expect(est.unavailableReason).toBe('On-demand is not cheaper at the observed traffic');
    expect(est.pricingSources).toHaveLength(4);
    expect(est.assumptions.some((a) => a.includes('189.8 USD/month') && a.includes('250 USD/month'))).toBe(true);
  });

  it('Redshift pause clamps the fraction and is UNAVAILABLE without pausable time', async () => {
    const base = { kind: 'REDSHIFT_PAUSE' as const, region: R, nodeType: 'ra3.xlplus', numberOfNodes: 1 };
    const over = await estimateRequestSavings({ ...base, pausableFraction: 1.5 }, new FakePriceProvider(), NOW);
    expect(over).toMatchObject({ monthly: 792.78, estimateType: 'POINT' });
    const none = await estimateRequestSavings({ ...base, pausableFraction: 0 }, new FakePriceProvider(), NOW);
    expect(none.status).toBe('UNAVAILABLE');
  });

  it('Backup retention prices only EBS bytes and states what was not priced', async () => {
    const est = await estimateRequestSavings(
      { kind: 'BACKUP_RETENTION_REDUCE', region: R, ebsGbBeyondRetention: 2000, otherGbBeyondRetention: 300 },
      new FakePriceProvider(),
      NOW,
    );
    expect(est.pricingSources[0]?.query).toEqual({ kind: 'EBS_SNAPSHOT_GB_MONTH', region: R });
    expect(est.assumptions.some((a) => a.includes('300 GB') && a.includes('not priced'))).toBe(true);

    const onlyOther = await estimateRequestSavings(
      { kind: 'BACKUP_RETENTION_REDUCE', region: R, ebsGbBeyondRetention: 0, otherGbBeyondRetention: 500 },
      new FakePriceProvider(),
      NOW,
    );
    expect(onlyOther.status).toBe('UNAVAILABLE');
    expect(onlyOther.assumptions.some((a) => a.includes('500 GB'))).toBe(true);
  });

  it.each<[string, SavingsRequest, RegExp]>([
    [
      'Lambda memory not lower',
      {
        kind: 'LAMBDA_MEMORY_RIGHTSIZE',
        region: R,
        architecture: 'x86_64',
        currentMemoryMb: 512,
        recommendedMemoryMb: 512,
        monthlyDurationSeconds: 1000,
      },
      /not lower/,
    ],
    [
      'Lambda arm64 provisioned concurrency without a price',
      {
        kind: 'LAMBDA_PROVISIONED_CONCURRENCY_REDUCE',
        region: R,
        architecture: 'arm64',
        memoryMb: 512,
        currentAllocated: 10,
        recommendedAllocated: 2,
      },
      /^NO_MATCHING_PRICE/,
    ],
    [
      'Lambda provisioned concurrency not lower',
      {
        kind: 'LAMBDA_PROVISIONED_CONCURRENCY_REDUCE',
        region: R,
        architecture: 'x86_64',
        memoryMb: 512,
        currentAllocated: 2,
        recommendedAllocated: 2,
      },
      /not lower/,
    ],
    [
      'ElastiCache without target',
      {
        kind: 'ELASTICACHE_RIGHTSIZE',
        region: R,
        cacheEngine: 'Redis',
        currentNodeType: 'cache.r6g.large',
        targetNodeType: null,
        numNodes: 1,
      },
      /No smaller node type/,
    ],
    [
      'ElastiCache target not cheaper',
      {
        kind: 'ELASTICACHE_RIGHTSIZE',
        region: R,
        cacheEngine: 'Redis',
        currentNodeType: 'cache.r6g.large',
        targetNodeType: 'cache.r6g.xlarge',
        numNodes: 1,
      },
      /not cheaper/,
    ],
    [
      'ElastiCache unknown node price',
      { kind: 'ELASTICACHE_DELETE', region: R, cacheEngine: 'Redis', cacheNodeType: 'cache.x9.huge', numNodes: 1 },
      /^NO_MATCHING_PRICE/,
    ],
    [
      'DynamoDB capacity not lower',
      {
        kind: 'DYNAMODB_RIGHTSIZE_PROVISIONED',
        region: R,
        tableClass: 'STANDARD',
        currentRcu: 5,
        currentWcu: 5,
        recommendedRcu: 5,
        recommendedWcu: 8,
      },
      /not lower/,
    ],
    [
      'DynamoDB missing on-demand price',
      {
        kind: 'DYNAMODB_SWITCH_TO_ON_DEMAND',
        region: R,
        tableClass: 'STANDARD_INFREQUENT_ACCESS',
        provisionedRcu: 100,
        provisionedWcu: 100,
        monthlyReadUnits: 1,
        monthlyWriteUnits: 1,
      },
      /^On-demand read request units: NO_MATCHING_PRICE/,
    ],
    [
      'Redshift unknown node type',
      { kind: 'REDSHIFT_PAUSE', region: R, nodeType: 'dc9.large', numberOfNodes: 1, pausableFraction: 1 },
      /^NO_MATCHING_PRICE/,
    ],
  ])('UNAVAILABLE: %s', async (_name, request, reason) => {
    const est = await estimateRequestSavings(request, new FakePriceProvider(), NOW);
    expect(est).toMatchObject({ status: 'UNAVAILABLE', monthly: null, annual: null });
    expect(est.unavailableReason).toMatch(reason);
  });

  it('EFS delete looks up only the storage classes that hold data', async () => {
    const pricing = new FakePriceProvider();
    const est = await estimateRequestSavings(
      { kind: 'EFS_DELETE', region: R, standardGb: 0, infrequentAccessGb: 0, archiveGb: 0, oneZone: false },
      pricing,
      NOW,
    );
    expect(est).toMatchObject({ status: 'ESTIMATED', monthly: 0 });
    expect(pricing.calls).toEqual([{ kind: 'EFS_STORAGE_GB_MONTH', region: R, storageClass: 'General Purpose' }]);
  });
});

describe('extended savings with the AWS Price List provider', () => {
  const pricingMock = mockClient(PricingClient);
  beforeEach(() => pricingMock.reset());
  const live = () =>
    new AwsPriceListProvider(new PricingClient({ region: R }), silentLogger, {
      retry: { baseDelayMs: 1, maxDelayMs: 2 },
      clock: () => NOW,
    });

  it('sums the EKS control plane and extended support from two GetProducts queries', async () => {
    pricingMock.on(GetProductsCommand).resolves({
      PriceList: [
        simpleEntry('CP', 'AmazonEKS-Hours:perCluster', 'Hours', '0.1000000000'),
        simpleEntry('EX', 'AmazonEKS-Hours:extendedSupport', 'Hours', '0.5000000000'),
      ],
    });
    const est = await estimateRequestSavings({ kind: 'EKS_CLUSTER_DELETE', region: R, supportType: 'EXTENDED' }, live(), NOW);
    expect(est.monthly).toBe(438);
    expect(est.pricingSources.map((s) => s.sku)).toEqual(['CP', 'EX']);
    expect(pricingMock.commandCalls(GetProductsCommand)).toHaveLength(2);
  });

  it('prices DynamoDB rightsizing at the paid tier, never the $0 free tier', async () => {
    const capacity = (sku: string, side: 'Read' | 'Write', usd: string) =>
      priceListEntry({
        sku,
        usagetype: `${side}CapacityUnit-Hrs`,
        productFamily: 'Provisioned IOPS',
        dimensions: [
          { usd: '0.0000000000', unit: `${side}CapacityUnit-Hrs`, beginRange: '0', endRange: '18600' },
          { usd, unit: `${side}CapacityUnit-Hrs`, beginRange: '18600' },
        ],
      });
    pricingMock.on(GetProductsCommand).resolves({
      PriceList: [capacity('R', 'Read', '0.0001300000'), capacity('W', 'Write', '0.0006500000')],
    });
    const est = await estimateRequestSavings(
      {
        kind: 'DYNAMODB_RIGHTSIZE_PROVISIONED',
        region: R,
        tableClass: 'STANDARD',
        currentRcu: 1000,
        currentWcu: 500,
        recommendedRcu: 200,
        recommendedWcu: 100,
      },
      live(),
      NOW,
    );
    expect(est.monthly).toBe(265.72);
    expect(est.pricingSources.map((s) => s.unitPriceUsd)).toEqual([0.00013, 0.00065]);
  });
});

describe('runEstimateSavingsStep (extended services)', () => {
  it('deduplicates identical price lookups across new request kinds', async () => {
    const eks = (resourceId: string, supportType: 'STANDARD' | 'EXTENDED') =>
      issue({
        resourceId,
        ruleId: 'idle-eks-cluster',
        resourceType: 'EKS_CLUSTER',
        suggestedAction: { type: 'DELETE_CLUSTER', summary: 'Delete it.', steps: [] },
        savingsRequest: { kind: 'EKS_CLUSTER_DELETE', region: R, supportType },
      });
    const table = (resourceId: string) =>
      issue({
        resourceId,
        ruleId: 'dynamodb-overprovisioned-capacity',
        resourceType: 'DYNAMODB_TABLE',
        suggestedAction: { type: 'RIGHTSIZE_TABLE_CAPACITY', summary: 'Lower it.', steps: [] },
        savingsRequest: {
          kind: 'DYNAMODB_RIGHTSIZE_PROVISIONED',
          region: R,
          tableClass: 'STANDARD',
          currentRcu: 100,
          currentWcu: 100,
          recommendedRcu: 10,
          recommendedWcu: 10,
        },
      });
    const artifacts = new MemoryArtifacts();
    await artifacts.putJson(
      ARTIFACT_KEYS.recommendations(PREFIX),
      envelope(generateRecommendations([eks('c1', 'STANDARD'), eks('c2', 'EXTENDED'), table('t1'), table('t2')])),
    );
    const pricing = new FakePriceProvider();
    const out = await runEstimateSavingsStep(
      baseState({ recommendations: { status: 'SUCCEEDED', artifactKey: ARTIFACT_KEYS.recommendations(PREFIX) } }),
      { artifacts, pricing, logger: silentLogger, now: () => NOW },
    );
    // EKS STANDARD (shared) + EKS EXTENDED + DynamoDB READ + WRITE
    expect(out.counts).toMatchObject({ recommendations: 4, priced: 4, priceLookups: 4, errors: 0 });
    expect(pricing.calls).toHaveLength(4);
    const written = await artifacts.getJson<ArtifactEnvelope<PricedRecommendationDraft[]>>(ARTIFACT_KEYS.savings(PREFIX));
    expect(written.data.map((d) => d.savings.monthly)).toEqual([73, 438, 70.96, 70.96]);
    expect(written.data[1]?.severity).toBe('HIGH');
  });
});
