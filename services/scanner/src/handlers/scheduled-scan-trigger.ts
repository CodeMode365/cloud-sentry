import { serializeError } from '@cloudsentry/utilities';
import { workerRuntime } from '../workflow/runtime';
import {
  runScheduledTrigger,
  type ScheduledScanEvent,
  type ScheduledTriggerResult,
} from '../workflow/scheduled-trigger';

export async function handler(event: ScheduledScanEvent): Promise<ScheduledTriggerResult> {
  const base = workerRuntime();
  const logger = base.logger.child({
    function: 'scheduled-scan-trigger',
    tenantId: event.tenantId,
    scheduleId: event.scheduleId,
  });
  try {
    const result = await runScheduledTrigger({ ...base, logger, ctx: { ...base.ctx, logger } }, event);
    logger.info('Scheduled trigger handled', { ...result });
    return result;
  } catch (error) {
    logger.error('Scheduled trigger failed', { error: serializeError(error) });
    throw error;
  }
}
