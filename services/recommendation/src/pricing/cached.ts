import type { PriceCache, PriceLookupResult, PriceQuery } from '@cloudsentry/shared-types';
import { awsErrorName, type Logger } from '@cloudsentry/utilities';
import { PRICE_UNAVAILABLE, priceCacheKey, type PriceProvider } from './provider';

export interface CachedPriceProviderOptions {
  /** TTL for found prices. Default 7 days. */
  ttlSeconds?: number;
  /** TTL for "no matching price"/"ambiguous" results. Default 1 day. API errors are never cached. */
  negativeTtlSeconds?: number;
}

/** Read-through cache in front of a PriceProvider. Cache failures degrade to uncached lookups. */
export class CachedPriceProvider implements PriceProvider {
  private readonly ttl: number;
  private readonly negativeTtl: number;

  constructor(
    private readonly inner: PriceProvider,
    private readonly cache: PriceCache,
    private readonly logger: Logger,
    options: CachedPriceProviderOptions = {},
  ) {
    this.ttl = options.ttlSeconds ?? 604_800;
    this.negativeTtl = options.negativeTtlSeconds ?? 86_400;
  }

  async getPrice(query: PriceQuery): Promise<PriceLookupResult> {
    const key = priceCacheKey(query);
    try {
      const hit = await this.cache.get(key);
      if (hit) return { ...hit, query };
    } catch (error) {
      this.logger.warn('Price cache read failed; querying the Price List API directly', {
        awsError: awsErrorName(error),
      });
    }
    const result = await this.inner.getPrice(query);
    if (result.unavailableReason?.startsWith(PRICE_UNAVAILABLE.API_ERROR)) return result;
    try {
      await this.cache.put(key, result, result.price ? this.ttl : this.negativeTtl);
    } catch (error) {
      this.logger.warn('Price cache write failed', { awsError: awsErrorName(error) });
    }
    return result;
  }
}

/** Deduplicates identical queries within one run (in-flight and completed). Create one per scan. */
export function memoizePriceProvider(inner: PriceProvider): PriceProvider & { readonly lookups: number } {
  const results = new Map<string, Promise<PriceLookupResult>>();
  let lookups = 0;
  return {
    get lookups() {
      return lookups;
    },
    getPrice(query: PriceQuery): Promise<PriceLookupResult> {
      const key = priceCacheKey(query);
      let pending = results.get(key);
      if (!pending) {
        lookups++;
        pending = inner.getPrice(query);
        results.set(key, pending);
      }
      return pending;
    },
  };
}
