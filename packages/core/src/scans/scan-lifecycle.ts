import type {
  ScanError,
  ScanExecution,
  ScanStatus,
  ScanStepName,
  ScanSummary,
  StepStatus,
} from '@cloudsentry/shared-types';
import { AppError, NotFoundError } from '@cloudsentry/utilities';
import type { ServiceContext } from '../context';

/** Thrown inside workflow steps when the scan was cancelled; the workflow's Catch marks it accordingly. */
export class ScanCancelledError extends AppError {
  constructor(scanId: string) {
    super('CONFLICT', `Scan ${scanId} was cancelled`, 409);
  }
}

/** Scan state transitions performed by workflow steps. */
export class ScanLifecycle {
  constructor(private readonly ctx: ServiceContext) {}

  async load(tenantId: string, scanId: string): Promise<ScanExecution> {
    const scan = await this.ctx.repos.scans.get(tenantId, scanId);
    if (!scan) throw new NotFoundError('Scan', scanId);
    return scan;
  }

  async assertActive(tenantId: string, scanId: string): Promise<ScanExecution> {
    const scan = await this.load(tenantId, scanId);
    if (scan.status === 'CANCELLED' || scan.cancelRequested) throw new ScanCancelledError(scanId);
    return scan;
  }

  async markRunning(tenantId: string, scanId: string): Promise<ScanExecution> {
    const scan = await this.assertActive(tenantId, scanId);
    if (scan.status === 'RUNNING') return scan;
    return this.ctx.repos.scans.update(
      tenantId,
      scanId,
      { status: 'RUNNING', startedAt: this.ctx.clock.now().toISOString() },
      { onlyIfStatusIn: ['PENDING', 'RUNNING'] },
    );
  }

  async step(
    tenantId: string,
    scanId: string,
    step: ScanStepName,
    status: StepStatus,
    message: string | null = null,
    startedAt?: string,
  ): Promise<void> {
    const now = this.ctx.clock.now().toISOString();
    await this.ctx.repos.scans.setStep(tenantId, scanId, step, {
      status,
      startedAt: startedAt ?? now,
      completedAt: status === 'RUNNING' ? null : now,
      message,
    });
  }

  recordErrors(tenantId: string, scanId: string, errors: ScanError[]): Promise<void> {
    return this.ctx.repos.scans.appendErrors(tenantId, scanId, errors);
  }

  async complete(
    tenantId: string,
    scanId: string,
    summary: ScanSummary,
    partial: boolean,
  ): Promise<ScanExecution> {
    const scan = await this.load(tenantId, scanId);
    const now = this.ctx.clock.now();
    const status: ScanStatus = partial ? 'PARTIALLY_COMPLETED' : 'COMPLETED';
    const updated = await this.ctx.repos.scans.update(
      tenantId,
      scanId,
      {
        status,
        summary,
        completedAt: now.toISOString(),
        durationMs: now.getTime() - new Date(scan.startedAt ?? scan.requestedAt).getTime(),
      },
      { onlyIfStatusIn: ['RUNNING', 'PENDING'] },
    );
    await this.ctx.repos.accounts.update(tenantId, scan.accountId, {
      lastSuccessfulScanAt: now.toISOString(),
    });
    await this.ctx.repos.scans.releaseLock(tenantId, scan.accountId, scanId);
    return updated;
  }

  async fail(tenantId: string, scanId: string, error: ScanError): Promise<ScanExecution | null> {
    const scan = await this.ctx.repos.scans.get(tenantId, scanId);
    if (!scan) return null;
    await this.ctx.repos.scans.releaseLock(tenantId, scan.accountId, scanId);
    if (scan.status === 'CANCELLED' || scan.status === 'FAILED') return scan;
    const now = this.ctx.clock.now();
    await this.ctx.repos.scans.appendErrors(tenantId, scanId, [error]);
    return this.ctx.repos.scans.update(tenantId, scanId, {
      status: 'FAILED',
      completedAt: now.toISOString(),
      durationMs: now.getTime() - new Date(scan.startedAt ?? scan.requestedAt).getTime(),
    });
  }
}
