import { createStepHandler } from '../workflow/handler-factory';
import { resolveRegions } from '../workflow/steps';

export const handler = createStepHandler('DiscoverResources', resolveRegions);
