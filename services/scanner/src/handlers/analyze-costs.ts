import { createStepHandler } from '../workflow/handler-factory';
import { analyzeCosts } from '../workflow/steps';

export const handler = createStepHandler('AnalyzeAWSCosts', analyzeCosts);
