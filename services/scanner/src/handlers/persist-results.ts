import { createStepHandler } from '../workflow/handler-factory';
import { persistResults } from '../workflow/steps';

export const handler = createStepHandler('PersistResults', persistResults);
