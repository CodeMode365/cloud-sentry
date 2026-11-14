import {
  GLOBAL_REGION,
  GLOBAL_RESOURCE_TYPES,
  type DiscoveredResource,
  type RegionError,
  type ResourceType,
} from '@cloudsentry/shared-types';
import {
  awsErrorName,
  errorMessage,
  isThrottlingError,
  mapSettledWithConcurrency,
  withRetry,
  type Logger,
} from '@cloudsentry/utilities';
import { DISCOVERY_MODULES, type DiscoveryClients, type DiscoveryModule } from './registry';

export interface RegionalDiscoveryOptions {
  accountId: string;
  logger: Logger;
  concurrency?: number;
  /** Override for tests. */
  modules?: Partial<Record<ResourceType, DiscoveryModule>>;
  /** Retry options for whole-region throttling that outlives the SDK's own retries. */
  retry?: { maxAttempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> };
}

export interface RegionalDiscoveryResult {
  resources: DiscoveredResource[];
  regionsSucceeded: string[];
  regionsFailed: RegionError[];
}

/**
 * Runs one resource type's discovery across regions. A failing region is recorded in `regionsFailed`
 * and never fails the others. Resources are deduplicated by (region, resourceId).
 *
 * Global types (GLOBAL_RESOURCE_TYPES, e.g. CloudFront) run exactly once with region `global`,
 * whatever the regions list holds; the outcome is reported as region `global`.
 */
export async function runRegionalDiscovery(
  resourceType: ResourceType,
  regions: readonly string[],
  clients: DiscoveryClients,
  options: RegionalDiscoveryOptions,
): Promise<RegionalDiscoveryResult> {
  const discover = options.modules?.[resourceType] ?? DISCOVERY_MODULES[resourceType];
  const logger = options.logger.child({ resourceType });
  const uniqueRegions = GLOBAL_RESOURCE_TYPES.includes(resourceType)
    ? [GLOBAL_REGION]
    : [...new Set(regions)];

  const settled = await mapSettledWithConcurrency(uniqueRegions, options.concurrency ?? 4, async (region) => {
    const started = Date.now();
    const ctx = { accountId: options.accountId, region, logger: logger.child({ region }) };
    const found = await withRetry(() => discover(clients, ctx), {
      maxAttempts: options.retry?.maxAttempts ?? 3,
      baseDelayMs: options.retry?.baseDelayMs ?? 1000,
      isRetryable: isThrottlingError,
      ...(options.retry?.sleep ? { sleep: options.retry.sleep } : {}),
      onRetry: (error, attempt, delayMs) =>
        logger.warn('Regional discovery throttled; retrying', {
          region,
          attempt,
          delayMs,
          awsError: awsErrorName(error),
        }),
    });
    logger.info('Regional discovery completed', {
      region,
      count: found.length,
      durationMs: Date.now() - started,
    });
    return found;
  });

  const seen = new Set<string>();
  const resources: DiscoveredResource[] = [];
  const regionsSucceeded: string[] = [];
  const regionsFailed: RegionError[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      regionsSucceeded.push(result.item);
      for (const resource of result.value) {
        const key = `${resource.region}|${resource.resourceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        resources.push(resource);
      }
    } else {
      const errorCode = awsErrorName(result.reason) ?? 'UnknownError';
      const message = errorMessage(result.reason);
      regionsFailed.push({ region: result.item, errorCode, message });
      logger.warn('Regional discovery failed', { region: result.item, errorCode, message });
    }
  }

  return { resources, regionsSucceeded, regionsFailed };
}
