import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Repositories } from '@cloudsentry/database';
import {
  ScanService,
  ScheduleService,
  type ScanWorkflowStarter,
  type SchedulerGateway,
  type ServiceContext,
} from '@cloudsentry/core';
import { fixedClock, silentLogger } from '@cloudsentry/utilities';
import { available, freshRepositories } from '../helpers/ddb';
import { NOW, account, seedTenant } from '../helpers/fixtures';

describe.skipIf(!available)('scan lifecycle and schedules (DynamoDB Local)', () => {
  let repos: Repositories;
  let ctx: ServiceContext;
  let auth: Awaited<ReturnType<typeof seedTenant>>['auth'];
  let viewer: Awaited<ReturnType<typeof seedTenant>>['auth'];
  const starts: string[] = [];
  const starter: ScanWorkflowStarter = {
    start: vi.fn(async (input) => {
      starts.push(input.scanId);
      return { executionArn: `arn:aws:states:us-east-1:111111111111:execution:sm:${input.scanId}` };
    }),
    stop: vi.fn(async () => undefined),
  };

  beforeAll(async () => {
    repos = await freshRepositories('scans');
    ctx = { repos, logger: silentLogger, clock: fixedClock(NOW) };
    auth = (await seedTenant(repos, 'ten_S', 'owner1')).auth;
    viewer = { ...auth, userId: 'viewer1', role: 'VIEWER' };
    await repos.accounts.create(account('ten_S', '111111111111'));
    await repos.accounts.create(account('ten_S', '222222222222', { status: 'PENDING_VERIFICATION' }));
    await repos.accounts.create(account('ten_S', '333333333333'));
  });

  it('starts a manual scan, then blocks a concurrent scan of the same account', async () => {
    const scans = new ScanService(ctx, starter);
    const { scan, created } = await scans.startManualScan(auth, '111111111111', {});
    expect(created).toBe(true);
    expect(scan).toMatchObject({ status: 'PENDING', trigger: 'MANUAL', triggeredBy: 'owner1' });
    expect(scan.executionArn).toContain(scan.scanId);
    await expect(scans.startManualScan(auth, '111111111111', {})).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('replays an idempotent request instead of starting a second execution', async () => {
    const scans = new ScanService(ctx, starter);
    const first = await scans.startManualScan(auth, '333333333333', {}, 'client-key-123');
    const again = await scans.startManualScan(auth, '333333333333', {}, 'client-key-123');
    expect(again.created).toBe(false);
    expect(again.scan.scanId).toBe(first.scan.scanId);
    expect(starts.filter((s) => s === first.scan.scanId)).toHaveLength(1);
  });

  it('refuses to scan unverified accounts and VIEWER callers', async () => {
    const scans = new ScanService(ctx, starter);
    await expect(scans.startManualScan(auth, '222222222222', {})).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    await expect(scans.startManualScan(viewer, '111111111111', {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('cancels a running scan and releases the account lock', async () => {
    const scans = new ScanService(ctx, starter);
    const page = await scans.list(auth, { limit: 10, accountId: '111111111111' });
    const scan = page.items[0];
    if (!scan) throw new Error('expected a scan');
    const cancelled = await scans.cancel(auth, scan.scanId);
    expect(cancelled.status).toBe('CANCELLED');
    expect(starter.stop).toHaveBeenCalled();
    expect(await repos.scans.getLock('ten_S', '111111111111', new Date(NOW))).toBeNull();
    await expect(scans.cancel(auth, scan.scanId)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('marks the scan FAILED and releases the lock when the workflow cannot start', async () => {
    const failing: ScanWorkflowStarter = {
      start: () => Promise.reject(new Error('sfn down')),
      stop: () => Promise.resolve(),
    };
    await repos.accounts.create(account('ten_S', '444444444444'));
    await expect(
      new ScanService(ctx, failing).startManualScan(auth, '444444444444', {}),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    expect(await repos.scans.getLock('ten_S', '444444444444', new Date(NOW))).toBeNull();
    const [failed] = (await repos.scans.list('ten_S', { limit: 5, accountId: '444444444444' })).items;
    expect(failed?.status).toBe('FAILED');
  });

  it('creates exactly one schedule per account and computes next execution', async () => {
    const upserts: string[] = [];
    const gateway: SchedulerGateway = {
      executesSchedules: true,
      upsert: async (s) => {
        upserts.push(s.expression);
      },
      delete: async () => undefined,
    };
    const schedules = new ScheduleService(ctx, gateway);
    const created = await schedules.create(auth, {
      accountId: '111111111111',
      frequency: 'DAILY',
      hour: 3,
      minute: 0,
      dayOfWeek: 2,
      timezone: 'UTC',
      enabled: true,
    });
    expect(created).toMatchObject({
      scheduleId: 'sch_111111111111',
      expression: 'cron(0 3 * * ? *)',
      status: 'ACTIVE',
    });
    expect(created.nextExecutionAt).toBe('2026-11-10T03:00:00.000Z');
    await expect(
      schedules.create(auth, {
        accountId: '111111111111',
        frequency: 'WEEKLY',
        hour: 1,
        minute: 0,
        dayOfWeek: 2,
        timezone: 'UTC',
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(upserts).toHaveLength(1);

    const updated = await schedules.update(auth, created.scheduleId, { enabled: false });
    expect(updated).toMatchObject({ enabled: false, status: 'DISABLED', nextExecutionAt: null });
    await schedules.delete(auth, created.scheduleId);
    expect(await schedules.list(auth)).toHaveLength(0);
  });

  it('rolls back the schedule record when EventBridge Scheduler fails', async () => {
    const gateway: SchedulerGateway = {
      executesSchedules: true,
      upsert: () => Promise.reject(new Error('scheduler down')),
      delete: async () => undefined,
    };
    const schedules = new ScheduleService(ctx, gateway);
    await expect(
      schedules.create(auth, {
        accountId: '333333333333',
        frequency: 'EVERY_6_HOURS',
        hour: 0,
        minute: 5,
        dayOfWeek: 2,
        timezone: 'UTC',
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    expect(await repos.schedules.get('ten_S', 'sch_333333333333')).toBeNull();
  });
});
