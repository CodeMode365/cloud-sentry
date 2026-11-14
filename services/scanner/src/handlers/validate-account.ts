import { createStepHandler } from '../workflow/handler-factory';
import { validateAccount } from '../workflow/steps';

export const handler = createStepHandler('ValidateAccount', validateAccount);
