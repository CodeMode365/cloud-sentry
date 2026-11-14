import { createStepHandler } from '../workflow/handler-factory';
import { collectMetrics } from '../workflow/steps';

export const handler = createStepHandler('CollectCloudWatchMetrics', collectMetrics);
