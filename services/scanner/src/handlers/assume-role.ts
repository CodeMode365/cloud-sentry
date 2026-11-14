import { createStepHandler } from '../workflow/handler-factory';
import { assumeCustomerRole } from '../workflow/steps';

export const handler = createStepHandler('AssumeCustomerRole', assumeCustomerRole);
