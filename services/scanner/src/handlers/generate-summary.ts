import { createStepHandler } from '../workflow/handler-factory';
import { generateSummary } from '../workflow/steps';

export const handler = createStepHandler('GenerateScanSummary', generateSummary);
