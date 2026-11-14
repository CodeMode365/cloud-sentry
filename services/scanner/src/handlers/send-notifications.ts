import { createStepHandler } from '../workflow/handler-factory';
import { sendNotifications } from '../workflow/steps';

export const handler = createStepHandler('SendNotifications', sendNotifications);
