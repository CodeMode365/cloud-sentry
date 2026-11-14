import type { AuthContext, ScanSchedule, ScanStatus } from '@cloudsentry/shared-types';
import type { CreateScheduleRequest, UpdateScheduleRequest } from '@cloudsentry/validators';
import { NotFoundError, PreconditionFailedError, UpstreamError, errorMessage } from '@cloudsentry/utilities';
import { requireRole } from '../auth/authorization';
import type { ServiceContext } from '../context';
import { buildScheduleExpression, nextExecution, type ScheduleSpec } from './expressions';
import type { SchedulerGateway } from './scheduler-gateway';

/** One schedule per account; the deterministic ID makes duplicate creation impossible. */
export const scheduleIdFor = (accountId: string) => `sch_${accountId}`;
export const schedulerNameFor = (tenantId: string, accountId: string) =>
  `cs-${tenantId}-${accountId}`.slice(0, 64);

interface StoredSpec extends ScheduleSpec {
  timezone: string;
}

export class ScheduleService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly gateway: SchedulerGateway,
  ) {}

  private withNext(s: ScanSchedule): ScanSchedule {
    const next = s.enabled ? nextExecution(s.expression, s.timezone, this.ctx.clock.now()) : null;
    return { ...s, nextExecutionAt: next?.toISOString() ?? null };
  }

  async list(auth: AuthContext, accountId?: string): Promise<ScanSchedule[]> {
    const items = await this.ctx.repos.schedules.list(auth.tenantId, accountId);
    return items.map((s) => this.withNext(s));
  }

  async get(auth: AuthContext, scheduleId: string): Promise<ScanSchedule> {
    const s = await this.ctx.repos.schedules.get(auth.tenantId, scheduleId);
    if (!s) throw new NotFoundError('Schedule', scheduleId);
    return this.withNext(s);
  }

  async create(auth: AuthContext, input: CreateScheduleRequest): Promise<ScanSchedule> {
    requireRole(auth, 'ADMIN');
    const account = await this.ctx.repos.accounts.get(auth.tenantId, input.accountId);
    if (!account) throw new NotFoundError('Account', input.accountId);
    if (account.dataSource === 'SYNTHETIC')
      throw new PreconditionFailedError('Synthetic accounts cannot be scheduled');
    const expression = buildScheduleExpression(input);
    const now = this.ctx.clock.now().toISOString();
    const schedule: ScanSchedule & { spec: StoredSpec } = {
      scheduleId: scheduleIdFor(input.accountId),
      tenantId: auth.tenantId,
      accountId: input.accountId,
      frequency: input.frequency,
      expression,
      timezone: input.timezone,
      enabled: input.enabled,
      status: input.enabled ? 'ACTIVE' : 'DISABLED',
      schedulerName: schedulerNameFor(auth.tenantId, input.accountId),
      lastExecutionAt: null,
      lastExecutionStatus: null,
      lastScanId: null,
      lastError: null,
      nextExecutionAt: null,
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
      version: 1,
      spec: { ...input },
    };
    // The record is written first: its conditional put is the duplicate guard.
    await this.ctx.repos.schedules.create(schedule);
    try {
      await this.gateway.upsert({
        name: schedule.schedulerName,
        expression,
        timezone: input.timezone,
        enabled: input.enabled,
        input: { tenantId: auth.tenantId, accountId: input.accountId, scheduleId: schedule.scheduleId },
      });
    } catch (error) {
      await this.ctx.repos.schedules.delete(auth.tenantId, schedule.scheduleId);
      this.ctx.logger.error('Failed to create EventBridge schedule', {
        error,
        scheduleId: schedule.scheduleId,
      });
      throw new UpstreamError('Could not create the schedule in EventBridge Scheduler', undefined, {
        cause: error,
      });
    }
    this.ctx.logger.audit('schedule.created', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      scheduleId: schedule.scheduleId,
      expression,
    });
    return this.withNext(schedule);
  }

  async update(auth: AuthContext, scheduleId: string, input: UpdateScheduleRequest): Promise<ScanSchedule> {
    requireRole(auth, 'ADMIN');
    const existing = (await this.ctx.repos.schedules.get(auth.tenantId, scheduleId)) as
      (ScanSchedule & { spec?: StoredSpec }) | null;
    if (!existing) throw new NotFoundError('Schedule', scheduleId);
    const prior: StoredSpec = existing.spec ?? {
      frequency: existing.frequency,
      cronExpression: existing.frequency === 'CUSTOM' ? existing.expression : undefined,
      hour: 2,
      minute: 0,
      dayOfWeek: 2,
      timezone: existing.timezone,
    };
    const spec: StoredSpec = {
      frequency: input.frequency ?? prior.frequency,
      cronExpression: input.cronExpression ?? prior.cronExpression,
      hour: input.hour ?? prior.hour,
      minute: input.minute ?? prior.minute,
      dayOfWeek: input.dayOfWeek ?? prior.dayOfWeek,
      timezone: input.timezone ?? prior.timezone,
    };
    const enabled = input.enabled ?? existing.enabled;
    const expression = buildScheduleExpression(spec);
    try {
      await this.gateway.upsert({
        name: existing.schedulerName,
        expression,
        timezone: spec.timezone,
        enabled,
        input: { tenantId: auth.tenantId, accountId: existing.accountId, scheduleId },
      });
    } catch (error) {
      throw new UpstreamError('Could not update the schedule in EventBridge Scheduler', undefined, {
        cause: error,
      });
    }
    const updated = await this.ctx.repos.schedules.update(
      auth.tenantId,
      scheduleId,
      {
        frequency: spec.frequency,
        expression,
        timezone: spec.timezone,
        enabled,
        status: enabled ? 'ACTIVE' : 'DISABLED',
        lastError: null,
        ...({ spec } as object),
      },
      existing.version,
    );
    this.ctx.logger.audit('schedule.updated', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      scheduleId,
      expression,
      enabled,
    });
    return this.withNext(updated);
  }

  async delete(auth: AuthContext, scheduleId: string): Promise<void> {
    requireRole(auth, 'ADMIN');
    const existing = await this.ctx.repos.schedules.get(auth.tenantId, scheduleId);
    if (!existing) throw new NotFoundError('Schedule', scheduleId);
    await this.gateway.delete(existing.schedulerName);
    await this.ctx.repos.schedules.delete(auth.tenantId, scheduleId);
    this.ctx.logger.audit('schedule.deleted', { tenantId: auth.tenantId, userId: auth.userId, scheduleId });
  }

  async deleteForAccount(auth: AuthContext, accountId: string): Promise<void> {
    const existing = await this.ctx.repos.schedules.get(auth.tenantId, scheduleIdFor(accountId));
    if (existing) await this.delete(auth, existing.scheduleId);
  }

  /** Called by the scheduled-scan-trigger Lambda after each firing. */
  async recordExecution(
    tenantId: string,
    scheduleId: string,
    outcome: { status: ScanStatus | 'SKIPPED' | 'TRIGGER_FAILED'; scanId: string | null; error?: unknown },
  ): Promise<void> {
    try {
      await this.ctx.repos.schedules.update(tenantId, scheduleId, {
        lastExecutionAt: this.ctx.clock.now().toISOString(),
        lastExecutionStatus: outcome.status,
        lastScanId: outcome.scanId,
        lastError: outcome.error ? errorMessage(outcome.error).slice(0, 500) : null,
        status: outcome.status === 'TRIGGER_FAILED' ? 'ERROR' : 'ACTIVE',
      });
    } catch (error) {
      this.ctx.logger.error('Failed to record schedule execution', { error, tenantId, scheduleId });
    }
  }
}
