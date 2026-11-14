import {
  ConflictException,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ResourceNotFoundException,
  SchedulerClient,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import type { Logger } from '@cloudsentry/utilities';

export interface SchedulerUpsert {
  name: string;
  expression: string;
  timezone: string;
  enabled: boolean;
  /** JSON payload delivered to the scheduled-scan-trigger Lambda. */
  input: { tenantId: string; accountId: string; scheduleId: string };
}

/** Port over EventBridge Scheduler. */
export interface SchedulerGateway {
  upsert(schedule: SchedulerUpsert): Promise<void>;
  delete(name: string): Promise<void>;
  /** True when schedules actually fire (false for the local development gateway). */
  readonly executesSchedules: boolean;
}

export interface EventBridgeSchedulerConfig {
  groupName: string;
  targetFunctionArn: string;
  roleArn: string;
}

export class EventBridgeSchedulerGateway implements SchedulerGateway {
  readonly executesSchedules = true;
  constructor(
    private readonly config: EventBridgeSchedulerConfig,
    private readonly client = new SchedulerClient({ region: process.env.AWS_REGION, maxAttempts: 4 }),
  ) {}

  private params(s: SchedulerUpsert) {
    return {
      Name: s.name,
      GroupName: this.config.groupName,
      ScheduleExpression: s.expression,
      ScheduleExpressionTimezone: s.timezone,
      State: s.enabled ? ('ENABLED' as const) : ('DISABLED' as const),
      FlexibleTimeWindow: { Mode: 'OFF' as const },
      Description: `CloudSentry scan schedule for account ${s.input.accountId}`,
      Target: {
        Arn: this.config.targetFunctionArn,
        RoleArn: this.config.roleArn,
        // <aws.scheduler.scheduled-time> is substituted by EventBridge Scheduler; it keys idempotent retries.
        Input: JSON.stringify({ ...s.input, scheduledTime: '<aws.scheduler.scheduled-time>' }),
        RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 },
      },
    };
  }

  async upsert(schedule: SchedulerUpsert): Promise<void> {
    try {
      await this.client.send(new CreateScheduleCommand(this.params(schedule)));
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      await this.client.send(new UpdateScheduleCommand(this.params(schedule)));
    }
  }

  async delete(name: string): Promise<void> {
    try {
      await this.client.send(new DeleteScheduleCommand({ Name: name, GroupName: this.config.groupName }));
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
    }
  }
}

/** Local development: schedules are stored but never fire. */
export class LocalSchedulerGateway implements SchedulerGateway {
  readonly executesSchedules = false;
  constructor(private readonly logger: Logger) {}
  upsert(schedule: SchedulerUpsert): Promise<void> {
    this.logger.warn('LOCAL DEV: schedule stored but not executed (no EventBridge Scheduler locally)', {
      name: schedule.name,
      expression: schedule.expression,
    });
    return Promise.resolve();
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
}
