import { createStepHandler } from '../workflow/handler-factory';
import { markScanFailed } from '../workflow/steps';

export const handler = createStepHandler('MarkScanFailed', markScanFailed);
