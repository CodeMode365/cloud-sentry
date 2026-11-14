import { ConflictError, PreconditionFailedError, NotFoundError, errorMessage } from '@cloudsentry/utilities';
import type { WorkerRuntime } from './runtime';

export interface ScheduledScanEvent {
  tenantId: string;
  accountId: string;
  scheduleId: string;
  /** Substituted by EventBridge Scheduler (<aws.scheduler.scheduled-time>). */
  scheduledTime?: string;
}

export type ScheduledTriggerResult =
  | { status: 'STARTED' | 'DUPLICATE'; scanId: string }
  | { status: 'SKIPPED' | 'TRIGGER_FAILED'; reason: string };

/**
 * Starts a scheduled scan through the same ScanService used by manual scans. The schedule's firing time is
 * the idempotency key, so Scheduler retries never start duplicate scans.
 */
export async function runScheduledTrigger(
  rt: WorkerRuntime,
  event: ScheduledScanEvent,
): Promise<ScheduledTriggerResult> {
  if (!rt.scanService) throw new Error('STATE_MACHINE_ARN is not configured');
  const schedule = await rt.repos.schedules.get(event.tenantId, event.scheduleId);
  if (!schedule || schedule.accountId !== event.accountId) {
    rt.logger.warn('Scheduled trigger for unknown schedule; ignoring', { ...event });
    return { status: 'SKIPPED', reason: 'SCHEDULE_NOT_FOUND' };
  }
  if (!schedule.enabled) return { status: 'SKIPPED', reason: 'SCHEDULE_DISABLED' };
  const firing = (event.scheduledTime ?? rt.clock.now().toISOString().slice(0, 16)).replace(
    /[^A-Za-z0-9_.:-]/g,
    '_',
  );
  try {
    const { scan, created } = await rt.scanService.startScan({
      tenantId: event.tenantId,
      accountId: event.accountId,
      trigger: 'SCHEDULED',
      triggeredBy: event.scheduleId,
      idempotencyKey: `sched_${event.scheduleId}_${firing}`.slice(0, 128),
    });
    await rt.schedules.recordExecution(event.tenantId, event.scheduleId, {
      status: scan.status,
      scanId: scan.scanId,
    });
    return { status: created ? 'STARTED' : 'DUPLICATE', scanId: scan.scanId };
  } catch (error) {
    if (error instanceof ConflictError) {
      await rt.schedules.recordExecution(event.tenantId, event.scheduleId, {
        status: 'SKIPPED',
        scanId: null,
        error: 'A scan was already in progress',
      });
      return { status: 'SKIPPED', reason: 'SCAN_IN_PROGRESS' };
    }
    if (error instanceof PreconditionFailedError || error instanceof NotFoundError) {
      await rt.schedules.recordExecution(event.tenantId, event.scheduleId, {
        status: 'TRIGGER_FAILED',
        scanId: null,
        error,
      });
      return { status: 'TRIGGER_FAILED', reason: errorMessage(error) };
    }
    await rt.schedules.recordExecution(event.tenantId, event.scheduleId, {
      status: 'TRIGGER_FAILED',
      scanId: null,
      error,
    });
    throw error; // transient: let EventBridge Scheduler retry
  }
}
