import type { DiscoveryWorkerInput, DiscoveryWorkerOutput } from '@cloudsentry/shared-types';
import { createStepHandler } from '../workflow/handler-factory';
import { discoverType } from '../workflow/steps';

export const handler = createStepHandler<DiscoveryWorkerOutput, DiscoveryWorkerInput>('ElastiCacheDiscovery', (rt, input) =>
  discoverType(rt, 'ELASTICACHE_CLUSTER', input),
);
