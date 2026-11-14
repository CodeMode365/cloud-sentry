import type { AuthContext, ScanExecution, ScanResultsResponse, ScanTrigger } from '@cloudsentry/shared-types';
import { ARTIFACT_KEYS, TERMINAL_SCAN_STATUSES } from '@cloudsentry/shared-types';
import type { ListScansQuery, StartScanRequest } from '@cloudsentry/validators';
import {
  ConflictError,
  NotFoundError,
  PreconditionFailedError,
  UpstreamError,
  ValidationError,
  newId,
} from '@cloudsentry/utilities';
import type { Page } from '@cloudsentry/database';
import { requireRole } from '../auth/authorization';
import type { ServiceContext } from '../context';
import type { ScanWorkflowStarter } from './workflow-starter';

export const SCAN_LOCK_TTL_SECONDS = 3 * 3600;
const IDEMPOTENCY_TTL_SECONDS = 24 * 3600;

export interface StartScanCommand {
  tenantId: string;
  accountId: string;
  trigger: ScanTrigger;
  triggeredBy: string;
  regions?: string[] | undefined;
  idempotencyKey?: string | undefined;
}

export class ScanService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly starter: ScanWorkflowStarter,
  ) {}

  /** Single entry point for manual and scheduled scans. Returns `created: false` for idempotent replays. */
  async startScan(cmd: StartScanCommand): Promise<{ scan: ScanExecution; created: boolean }> {
    const { repos, clock, logger } = this.ctx;
    const account = await repos.accounts.get(cmd.tenantId, cmd.accountId);
    if (!account) throw new NotFoundError('Account', cmd.accountId);
    if (account.dataSource === 'SYNTHETIC')
      throw new PreconditionFailedError('Synthetic accounts cannot be scanned');
    if (account.status !== 'CONNECTED') {
      throw new PreconditionFailedError('The account connection must be verified before scanning');
    }
    const regions = cmd.regions ?? account.regions;
    const outside = regions.filter((r) => !account.regions.includes(r));
    if (outside.length)
      throw new ValidationError(`Regions not configured for this account: ${outside.join(', ')}`);

    const now = clock.now();
    const scanId = newId.scan();
    if (cmd.idempotencyKey) {
      const existingId = await repos.scans.claimIdempotencyKey(
        cmd.tenantId,
        cmd.idempotencyKey,
        scanId,
        IDEMPOTENCY_TTL_SECONDS,
        now,
      );
      if (existingId) {
        const existing = await repos.scans.get(cmd.tenantId, existingId);
        if (existing) return { scan: existing, created: false };
      }
    }

    const locked = await repos.scans.acquireLock(
      cmd.tenantId,
      cmd.accountId,
      scanId,
      SCAN_LOCK_TTL_SECONDS,
      now,
    );
    if (!locked) {
      if (cmd.idempotencyKey)
        await repos.scans.releaseIdempotencyKey(cmd.tenantId, cmd.idempotencyKey, scanId);
      const lock = await repos.scans.getLock(cmd.tenantId, cmd.accountId, now);
      throw new ConflictError('A scan is already in progress for this account', {
        scanId: lock?.scanId ?? null,
      });
    }

    const iso = now.toISOString();
    const scan: ScanExecution = {
      scanId,
      tenantId: cmd.tenantId,
      accountId: cmd.accountId,
      trigger: cmd.trigger,
      triggeredBy: cmd.triggeredBy,
      status: 'PENDING',
      executionArn: null,
      regions: [...regions].sort(),
      requestedAt: iso,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      steps: {},
      discovery: [],
      summary: null,
      errors: [],
      artifactsPrefix: ARTIFACT_KEYS.scanPrefix(cmd.accountId, scanId, cmd.tenantId),
      cancelRequested: false,
      createdAt: iso,
      updatedAt: iso,
      version: 1,
    };
    await repos.scans.create(scan);
    try {
      const { executionArn } = await this.starter.start({
        tenantId: cmd.tenantId,
        accountId: cmd.accountId,
        scanId,
        trigger: cmd.trigger,
      });
      scan.executionArn = executionArn;
      const updated = await repos.scans.update(cmd.tenantId, scanId, { executionArn });
      Object.assign(scan, updated);
    } catch (error) {
      logger.error('Failed to start scan workflow', { error, scanId, accountId: cmd.accountId });
      await repos.scans.update(cmd.tenantId, scanId, {
        status: 'FAILED',
        completedAt: clock.now().toISOString(),
        errors: [
          {
            step: 'Workflow',
            code: 'START_FAILED',
            message: 'The scan workflow could not be started',
            at: iso,
          },
        ],
      });
      await repos.scans.releaseLock(cmd.tenantId, cmd.accountId, scanId);
      throw new UpstreamError('The scan workflow could not be started', undefined, { cause: error });
    }
    await repos.accounts.update(cmd.tenantId, cmd.accountId, { lastScanId: scanId, lastScanAt: iso });
    logger.audit('scan.started', {
      tenantId: cmd.tenantId,
      accountId: cmd.accountId,
      scanId,
      trigger: cmd.trigger,
      triggeredBy: cmd.triggeredBy,
    });
    return { scan, created: true };
  }

  async startManualScan(
    auth: AuthContext,
    accountId: string,
    input: StartScanRequest,
    idempotencyKey?: string,
  ) {
    requireRole(auth, 'MEMBER');
    return this.startScan({
      tenantId: auth.tenantId,
      accountId,
      trigger: 'MANUAL',
      triggeredBy: auth.userId,
      regions: input.regions,
      idempotencyKey,
    });
  }

  list(auth: AuthContext, query: ListScansQuery): Promise<Page<ScanExecution>> {
    return this.ctx.repos.scans.list(auth.tenantId, {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.status ? { status: query.status } : {}),
    });
  }

  async get(auth: AuthContext, scanId: string): Promise<ScanExecution> {
    const scan = await this.ctx.repos.scans.get(auth.tenantId, scanId);
    if (!scan) throw new NotFoundError('Scan', scanId);
    return scan;
  }

  async results(auth: AuthContext, scanId: string): Promise<ScanResultsResponse> {
    const scan = await this.get(auth, scanId);
    const [findings, recommendations] = await Promise.all([
      this.ctx.repos.findings.listAll(auth.tenantId, { accountId: scan.accountId }),
      this.ctx.repos.recommendations.listAll(auth.tenantId, { accountId: scan.accountId }),
    ]);
    return {
      scan,
      findings: findings.filter((f) => f.lastScanId === scanId),
      recommendations: recommendations.filter((r) => r.lastScanId === scanId),
    };
  }

  async cancel(auth: AuthContext, scanId: string): Promise<ScanExecution> {
    requireRole(auth, 'MEMBER');
    const scan = await this.get(auth, scanId);
    if (TERMINAL_SCAN_STATUSES.includes(scan.status)) {
      throw new ConflictError(`Scan is already ${scan.status}`);
    }
    if (scan.executionArn) {
      try {
        await this.starter.stop(scan.executionArn, `Cancelled by ${auth.userId}`);
      } catch (error) {
        this.ctx.logger.warn('StopExecution failed; marking scan cancelled anyway', { error, scanId });
      }
    }
    const now = this.ctx.clock.now();
    const updated = await this.ctx.repos.scans.update(
      auth.tenantId,
      scanId,
      {
        status: 'CANCELLED',
        cancelRequested: true,
        completedAt: now.toISOString(),
        durationMs: scan.startedAt ? now.getTime() - new Date(scan.startedAt).getTime() : null,
      },
      { onlyIfStatusIn: ['PENDING', 'RUNNING'] },
    );
    await this.ctx.repos.scans.releaseLock(auth.tenantId, scan.accountId, scanId);
    this.ctx.logger.audit('scan.cancelled', { tenantId: auth.tenantId, userId: auth.userId, scanId });
    return updated;
  }
}
