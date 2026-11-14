import type { PriceLookupResult, PriceQuery } from '@cloudsentry/shared-types';
import { sha256Hex } from '@cloudsentry/utilities';

/** Source of unit prices. Implementations must never fabricate a price: unknown => price null + reason. */
export interface PriceProvider {
  getPrice(query: PriceQuery): Promise<PriceLookupResult>;
}

/** Reason-code prefixes used in PriceLookupResult.unavailableReason. */
export const PRICE_UNAVAILABLE = {
  NO_MATCH: 'NO_MATCHING_PRICE',
  AMBIGUOUS: 'AMBIGUOUS_PRICE',
  API_ERROR: 'PRICING_API_ERROR',
} as const;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Stable cache key for a price query (independent of property order). */
export function priceCacheKey(query: PriceQuery): string {
  return `v1-${sha256Hex(canonicalJson(query))}`;
}
