import { describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetProductsCommand, PricingClient } from '@aws-sdk/client-pricing';
import type { PriceCache, PriceLookupResult, PriceQuery } from '@cloudsentry/shared-types';
import { silentLogger } from '@cloudsentry/utilities';
import { FakePriceProvider } from '../__fixtures__/issues';
import { priceListEntry } from '../__fixtures__/price-list';
import { AwsPriceListProvider } from './aws-price-list';
import { CachedPriceProvider, memoizePriceProvider } from './cached';
import { priceCacheKey, type PriceProvider } from './provider';

class MemoryCache implements PriceCache {
  entries = new Map<string, { value: PriceLookupResult; ttl: number }>();
  failReads = false;
  async get(key: string) {
    if (this.failReads) throw Object.assign(new Error('down'), { name: 'ServiceUnavailable' });
    return this.entries.get(key)?.value ?? null;
  }
  async put(key: string, value: PriceLookupResult, ttl: number) {
    this.entries.set(key, { value, ttl });
  }
}

const q: PriceQuery = { kind: 'NAT_GATEWAY_HOURLY', region: 'us-east-1' };

describe('priceCacheKey', () => {
  it('is independent of property order', () => {
    expect(priceCacheKey({ kind: 'EBS_STORAGE_GB_MONTH', region: 'r', volumeApiName: 'gp3' })).toBe(
      priceCacheKey({ volumeApiName: 'gp3', region: 'r', kind: 'EBS_STORAGE_GB_MONTH' } as PriceQuery),
    );
    expect(priceCacheKey(q)).not.toBe(priceCacheKey({ ...q, region: 'eu-west-1' }));
  });
});

describe('CachedPriceProvider', () => {
  it('serves hits from cache and stores misses with the positive TTL', async () => {
    const inner = new FakePriceProvider();
    const cache = new MemoryCache();
    const p = new CachedPriceProvider(inner, cache, silentLogger);
    await p.getPrice(q);
    await p.getPrice(q);
    expect(inner.calls).toHaveLength(1);
    expect(cache.entries.get(priceCacheKey(q))?.ttl).toBe(604_800);
  });

  it('caches negative results briefly and never caches API errors', async () => {
    const cache = new MemoryCache();
    await new CachedPriceProvider(new FakePriceProvider({}), cache, silentLogger).getPrice(q);
    expect(cache.entries.get(priceCacheKey(q))?.ttl).toBe(86_400);

    const errorCache = new MemoryCache();
    const failing: PriceProvider = {
      getPrice: async (query) => ({ query, price: null, unavailableReason: 'PRICING_API_ERROR: x' }),
    };
    await new CachedPriceProvider(failing, errorCache, silentLogger).getPrice(q);
    expect(errorCache.entries.size).toBe(0);
  });

  it('falls through to the inner provider when the cache is unavailable', async () => {
    const cache = new MemoryCache();
    cache.failReads = true;
    const inner = new FakePriceProvider();
    const result = await new CachedPriceProvider(inner, cache, silentLogger).getPrice(q);
    expect(result.price?.unitPriceUsd).toBe(0.045);
  });
});

describe('memoizePriceProvider', () => {
  it('deduplicates concurrent identical lookups', async () => {
    const inner = new FakePriceProvider();
    const m = memoizePriceProvider(inner);
    await Promise.all([
      m.getPrice(q),
      m.getPrice({ region: 'us-east-1', kind: 'NAT_GATEWAY_HOURLY' }),
      m.getPrice({ ...q, region: 'eu-west-1' }),
    ]);
    expect(inner.calls).toHaveLength(2);
    expect(m.lookups).toBe(2);
  });
});

describe('caching extended price queries', () => {
  it('keys distinguish the attributes that change the price', () => {
    const eks = { kind: 'EKS_CLUSTER_HOURLY', region: 'us-east-1' } as const;
    expect(priceCacheKey({ ...eks, supportType: 'STANDARD' })).not.toBe(
      priceCacheKey({ ...eks, supportType: 'EXTENDED' }),
    );
    const ddb = {
      kind: 'DYNAMODB_PROVISIONED_CAPACITY_HOURLY',
      region: 'us-east-1',
      tableClass: 'STANDARD',
    } as const;
    expect(priceCacheKey({ ...ddb, capacity: 'READ' })).not.toBe(
      priceCacheKey({ ...ddb, capacity: 'WRITE' }),
    );
    expect(
      priceCacheKey({ kind: 'DYNAMODB_STORAGE_GB_MONTH', region: 'us-east-1', tableClass: 'STANDARD' }),
    ).not.toBe(
      priceCacheKey({
        kind: 'DYNAMODB_STORAGE_GB_MONTH',
        region: 'us-east-1',
        tableClass: 'STANDARD_INFREQUENT_ACCESS',
      }),
    );
  });

  it('serves a paid-tier Price List result from the cache on the second lookup', async () => {
    const pricingMock = mockClient(PricingClient);
    pricingMock.on(GetProductsCommand).resolves({
      PriceList: [
        priceListEntry({
          sku: 'S',
          usagetype: 'TimedStorage-ByteHrs',
          productFamily: 'Database Storage',
          dimensions: [
            { usd: '0.0000000000', unit: 'GB-Mo', beginRange: '0', endRange: '25' },
            { usd: '0.2500000000', unit: 'GB-Mo', beginRange: '25' },
          ],
        }),
      ],
    });
    const live = new AwsPriceListProvider(new PricingClient({ region: 'us-east-1' }), silentLogger, {
      retry: { baseDelayMs: 1, maxDelayMs: 2 },
    });
    const cache = new MemoryCache();
    const cached = new CachedPriceProvider(live, cache, silentLogger);
    const query: PriceQuery = {
      kind: 'DYNAMODB_STORAGE_GB_MONTH',
      region: 'us-east-1',
      tableClass: 'STANDARD',
    };
    const first = await cached.getPrice(query);
    const second = await cached.getPrice(query);
    expect(first.price?.unitPriceUsd).toBe(0.25);
    expect(second.price?.unitPriceUsd).toBe(0.25);
    expect(pricingMock.commandCalls(GetProductsCommand)).toHaveLength(1);
    expect(cache.entries.get(priceCacheKey(query))?.ttl).toBe(604_800);
    pricingMock.restore();
  });

  it('memoizes the EKS control-plane lookup shared by standard and extended clusters', async () => {
    const inner = new FakePriceProvider();
    const m = memoizePriceProvider(inner);
    const eks = { kind: 'EKS_CLUSTER_HOURLY', region: 'us-east-1' } as const;
    await Promise.all([
      m.getPrice({ ...eks, supportType: 'STANDARD' }),
      m.getPrice({ ...eks, supportType: 'STANDARD' }),
      m.getPrice({ ...eks, supportType: 'EXTENDED' }),
    ]);
    expect(m.lookups).toBe(2);
  });
});
