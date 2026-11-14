import { PricingClient } from '@aws-sdk/client-pricing';
import type { PriceCache } from '@cloudsentry/shared-types';
import { clientDefaults, PRICING_API_REGION } from '@cloudsentry/aws-clients';
import type { Logger } from '@cloudsentry/utilities';
import { AwsPriceListProvider } from './aws-price-list';
import { CachedPriceProvider } from './cached';
import type { PriceProvider } from './provider';

export interface PricingServiceOptions {
  logger: Logger;
  /** Persistent cache (DynamoDB in deployed environments). Optional. */
  cache?: PriceCache;
  client?: PricingClient;
  /** Price List API endpoint region: us-east-1 (default), eu-central-1 or ap-south-1. */
  region?: string;
}

/** Composes the production pricing engine: AWS Price List API, optionally behind a persistent cache. */
export function createPricingService(options: PricingServiceOptions): PriceProvider {
  const client =
    options.client ??
    new PricingClient({ region: options.region ?? PRICING_API_REGION, ...clientDefaults() });
  const live = new AwsPriceListProvider(client, options.logger.child({ component: 'pricing' }));
  return options.cache ? new CachedPriceProvider(live, options.cache, options.logger) : live;
}
