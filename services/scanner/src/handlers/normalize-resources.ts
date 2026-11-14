import { createStepHandler } from '../workflow/handler-factory';
import { normalize } from '../workflow/steps';

export const handler = createStepHandler('NormalizeResourceData', normalize);
