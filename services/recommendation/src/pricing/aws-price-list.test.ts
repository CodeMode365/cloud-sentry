import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetProductsCommand, PricingClient } from '@aws-sdk/client-pricing';
import { silentLogger } from '@cloudsentry/utilities';
import { AwsPriceListProvider } from './aws-price-list';

/** Synthetic Price List entries shaped like real GetProducts responses (values from a live us-east-1 query). */
function entry(
  sku: string,
  usagetype: string,
  unit: string,
  usd: string,
  attrs: Record<string, string> = {},
): string {
  return JSON.stringify({
    product: { sku, productFamily: 'x', attributes: { usagetype, regionCode: 'us-east-1', ...attrs } },
    terms: {
      OnDemand: {
        [`${sku}.JRTCKXETXF`]: {
          effectiveDate: '2026-10-01T00:00:00Z',
          priceDimensions: {
            [`${sku}.JRTCKXETXF.6YS6EN2CT7`]: {
              unit,
              beginRange: '0',
              endRange: 'Inf',
              description: `${usd} per ${unit}`,
              pricePerUnit: { USD: usd },
            },
          },
        },
      },
    },
  });
}

const pricingMock = mockClient(PricingClient);
const provider = () =>
  new AwsPriceListProvider(new PricingClient({ region: 'us-east-1' }), silentLogger, {
    retry: { baseDelayMs: 1, maxDelayMs: 2 },
    clock: () => new Date('2026-11-01T00:00:00Z'),
  });

beforeEach(() => pricingMock.reset());

describe('AwsPriceListProvider', () => {
  it('prices an EC2 instance with verified TERM_MATCH filters', async () => {
    pricingMock
      .on(GetProductsCommand)
      .resolves({ PriceList: [entry('SKU1', 'BoxUsage:t3.micro', 'Hrs', '0.0104000000')] });
    const result = await provider().getPrice({
      kind: 'EC2_INSTANCE_HOURLY',
      region: 'us-east-1',
      instanceType: 't3.micro',
      operatingSystem: 'Linux',
      tenancy: 'Shared',
      preInstalledSw: 'NA',
      licenseModel: 'No License required',
    });
    expect(result.price).toMatchObject({
      unitPriceUsd: 0.0104,
      unit: 'Hrs',
      sku: 'SKU1',
      source: 'AWS_PRICE_LIST_API',
      retrievedAt: '2026-11-01T00:00:00.000Z',
    });
    const input = pricingMock.commandCalls(GetProductsCommand)[0]?.args[0].input;
    expect(input?.ServiceCode).toBe('AmazonEC2');
    expect(input?.Filters).toEqual(
      expect.arrayContaining([
        { Type: 'TERM_MATCH', Field: 'capacitystatus', Value: 'Used' },
        { Type: 'TERM_MATCH', Field: 'instanceType', Value: 't3.micro' },
        { Type: 'TERM_MATCH', Field: 'licenseModel', Value: 'No License required' },
      ]),
    );
  });

  it('selects the idle public IPv4 price, not the in-use one', async () => {
    pricingMock.on(GetProductsCommand).resolves({
      PriceList: [
        entry('A', 'USE1-PublicIPv4:InUseAddress', 'Hrs', '0.0050000000'),
        entry('B', 'USE1-PublicIPv4:IdleAddress', 'Hrs', '0.0050000000'),
      ],
    });
    const result = await provider().getPrice({ kind: 'PUBLIC_IPV4_IDLE_HOURLY', region: 'us-east-1' });
    expect(result.price?.sku).toBe('B');
    expect(pricingMock.commandCalls(GetProductsCommand)[0]?.args[0].input.ServiceCode).toBe('AmazonVPC');
  });

  it('selects RDS InstanceUsage and ignores UnusedBox', async () => {
    pricingMock.on(GetProductsCommand).resolves({
      PriceList: [
        entry('U', 'UnusedBox:db.t3.micro', 'Hrs', '0.0190000000'),
        entry('I', 'InstanceUsage:db.t3.micro', 'Hrs', '0.0180000000'),
      ],
    });
    const result = await provider().getPrice({
      kind: 'RDS_INSTANCE_HOURLY',
      region: 'us-east-1',
      instanceClass: 'db.t3.micro',
      databaseEngine: 'PostgreSQL',
      deploymentOption: 'Single-AZ',
    });
    expect(result.price).toMatchObject({ sku: 'I', unitPriceUsd: 0.018 });
  });

  it('selects NAT Gateway hours among bytes and provisioned-bandwidth products', async () => {
    pricingMock.on(GetProductsCommand).resolves({
      PriceList: [
        entry('P', 'NatGateway-Prvd-Gbps', 'Gbps-hrs', '1.0760000000'),
        entry('R', 'USE1-RegionalNatGateway-Bytes', 'GB', '0.0450000000'),
        entry('Y', 'NatGateway-Bytes', 'GB', '0.0450000000'),
        entry('RH', 'USE1-RegionalNatGateway-Hours', 'Hrs', '0.0900000000'),
        entry('H', 'NatGateway-Hours', 'Hrs', '0.0450000000'),
      ],
    });
    const result = await provider().getPrice({ kind: 'NAT_GATEWAY_HOURLY', region: 'us-east-1' });
    expect(result.price).toMatchObject({ sku: 'H', unitPriceUsd: 0.045 });
  });

  it('selects standard snapshot storage, not archive usage types', async () => {
    pricingMock.on(GetProductsCommand).resolves({
      PriceList: [
        entry('S', 'EBS:SnapshotUsage', 'GB-Mo', '0.0500000000'),
        entry('AR', 'EBS:SnapshotArchiveRetrieval', 'GB', '0.0300000000'),
        entry('AE', 'EBS:SnapshotArchiveEarlyDelete', 'GB-Mo', '0.0125000000'),
      ],
    });
    const result = await provider().getPrice({ kind: 'EBS_SNAPSHOT_GB_MONTH', region: 'us-east-1' });
    expect(result.price).toMatchObject({ sku: 'S', unitPriceUsd: 0.05 });
  });

  it('follows NextToken pagination', async () => {
    pricingMock
      .on(GetProductsCommand)
      .resolvesOnce({
        PriceList: [entry('X', 'EBS:SnapshotArchiveRetrieval', 'GB', '0.03')],
        NextToken: 'page2',
      })
      .resolvesOnce({ PriceList: [entry('S', 'EBS:SnapshotUsage', 'GB-Mo', '0.05')] });
    const result = await provider().getPrice({ kind: 'EBS_SNAPSHOT_GB_MONTH', region: 'us-east-1' });
    expect(result.price?.sku).toBe('S');
    expect(pricingMock.commandCalls(GetProductsCommand)[1]?.args[0].input.NextToken).toBe('page2');
  });

  it('returns null with a reason when nothing matches', async () => {
    pricingMock.on(GetProductsCommand).resolves({ PriceList: [] });
    const result = await provider().getPrice({
      kind: 'EBS_STORAGE_GB_MONTH',
      region: 'us-east-1',
      volumeApiName: 'gp9',
    });
    expect(result.price).toBeNull();
    expect(result.unavailableReason).toMatch(/^NO_MATCHING_PRICE/);
  });

  it('returns null when matching prices are ambiguous', async () => {
    pricingMock.on(GetProductsCommand).resolves({
      PriceList: [
        entry('A', 'EBS:VolumeUsage.gp3', 'GB-Mo', '0.08'),
        entry('B', 'EBS:VolumeUsage.gp3', 'GB-Mo', '0.09'),
      ],
    });
    const result = await provider().getPrice({
      kind: 'EBS_STORAGE_GB_MONTH',
      region: 'us-east-1',
      volumeApiName: 'gp3',
    });
    expect(result.price).toBeNull();
    expect(result.unavailableReason).toMatch(/^AMBIGUOUS_PRICE/);
  });

  it('retries throttling and reports non-retryable API errors as unavailable', async () => {
    const throttle = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    pricingMock
      .on(GetProductsCommand)
      .rejectsOnce(throttle)
      .resolvesOnce({ PriceList: [entry('S', 'EBS:SnapshotUsage', 'GB-Mo', '0.05')] });
    expect(
      (await provider().getPrice({ kind: 'EBS_SNAPSHOT_GB_MONTH', region: 'us-east-1' })).price?.sku,
    ).toBe('S');

    pricingMock.reset();
    pricingMock
      .on(GetProductsCommand)
      .rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    const result = await provider().getPrice({ kind: 'EBS_SNAPSHOT_GB_MONTH', region: 'us-east-1' });
    expect(result.price).toBeNull();
    expect(result.unavailableReason).toMatch(/^PRICING_API_ERROR: AccessDeniedException/);
    expect(pricingMock.commandCalls(GetProductsCommand)).toHaveLength(1);
  });
});
