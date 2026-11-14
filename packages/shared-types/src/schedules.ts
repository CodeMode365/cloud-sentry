import type { ScanStatus, ScheduleFrequency, ScheduleStatus } from './enums';

export interface ScanSchedule {
  scheduleId: string;
  tenantId: string;
  accountId: string;
  frequency: ScheduleFrequency;
  /** EventBridge Scheduler expression: rate(...) or cron(...). */
  expression: string;
  timezone: string;
  enabled: boolean;
  status: ScheduleStatus;
  /** Name of the EventBridge Scheduler schedule. */
  schedulerName: string;
  lastExecutionAt: string | null;
  lastExecutionStatus: ScanStatus | 'SKIPPED' | 'TRIGGER_FAILED' | null;
  lastScanId: string | null;
  lastError: string | null;
  nextExecutionAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
