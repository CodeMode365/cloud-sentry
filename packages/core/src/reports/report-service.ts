import type { ArtifactStore } from '@cloudsentry/aws-clients';
import type { AuthContext, DownloadUrlResponse, ReportRecord } from '@cloudsentry/shared-types';
import { ARTIFACT_KEYS } from '@cloudsentry/shared-types';
import type { CreateReportRequest } from '@cloudsentry/validators';
import type { Page } from '@cloudsentry/database';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import {
  NotFoundError,
  PreconditionFailedError,
  UpstreamError,
  addDays,
  isoDate,
  newId,
} from '@cloudsentry/utilities';
import { requireRole } from '../auth/authorization';
import type { ServiceContext } from '../context';

/** Port that triggers asynchronous report generation. */
export interface ReportTrigger {
  trigger(request: { tenantId: string; reportId: string }): Promise<void>;
}

export class LambdaReportTrigger implements ReportTrigger {
  constructor(
    private readonly functionName: string,
    private readonly client = new LambdaClient({ region: process.env.AWS_REGION, maxAttempts: 3 }),
  ) {}
  async trigger(request: { tenantId: string; reportId: string }): Promise<void> {
    await this.client.send(
      new InvokeCommand({
        FunctionName: this.functionName,
        InvocationType: 'Event',
        Payload: new TextEncoder().encode(JSON.stringify(request)),
      }),
    );
  }
}

const DOWNLOAD_TTL_SECONDS = 300;

export class ReportService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly trigger: ReportTrigger,
    private readonly artifacts: ArtifactStore,
  ) {}

  async create(auth: AuthContext, input: CreateReportRequest): Promise<ReportRecord> {
    requireRole(auth, 'MEMBER');
    if (input.accountId) {
      const account = await this.ctx.repos.accounts.get(auth.tenantId, input.accountId);
      if (!account) throw new NotFoundError('Account', input.accountId);
    }
    const now = this.ctx.clock.now();
    const days = input.type === 'WEEKLY' ? 7 : 30;
    const reportId = newId.report();
    const ext = input.format === 'PDF' ? 'pdf' : 'json';
    const report: ReportRecord = {
      reportId,
      tenantId: auth.tenantId,
      accountId: input.accountId,
      type: input.type,
      format: input.format,
      status: 'PENDING',
      title: `CloudSentry ${input.type === 'ON_DEMAND' ? 'on-demand' : input.type.toLowerCase()} report ${isoDate(now)}`,
      periodStart: addDays(now, -days).toISOString(),
      periodEnd: now.toISOString(),
      s3Key: ARTIFACT_KEYS.report(auth.tenantId, input.accountId ?? 'all', input.type, reportId, ext),
      sizeBytes: null,
      requestedBy: auth.userId,
      error: null,
      createdAt: now.toISOString(),
      completedAt: null,
      updatedAt: now.toISOString(),
      version: 1,
    };
    await this.ctx.repos.reports.create(report);
    try {
      await this.trigger.trigger({ tenantId: auth.tenantId, reportId });
    } catch (error) {
      await this.ctx.repos.reports.update(auth.tenantId, reportId, {
        status: 'FAILED',
        error: 'Report generation could not be started',
      });
      throw new UpstreamError('Report generation could not be started', undefined, { cause: error });
    }
    this.ctx.logger.audit('report.requested', { tenantId: auth.tenantId, userId: auth.userId, reportId });
    return report;
  }

  list(auth: AuthContext, page: { limit: number; cursor?: string | undefined }): Promise<Page<ReportRecord>> {
    return this.ctx.repos.reports.list(auth.tenantId, {
      limit: page.limit,
      ...(page.cursor ? { cursor: page.cursor } : {}),
    });
  }

  async get(auth: AuthContext, reportId: string): Promise<ReportRecord> {
    const r = await this.ctx.repos.reports.get(auth.tenantId, reportId);
    if (!r) throw new NotFoundError('Report', reportId);
    return r;
  }

  async downloadUrl(auth: AuthContext, reportId: string): Promise<DownloadUrlResponse> {
    const report = await this.get(auth, reportId);
    if (report.status !== 'READY' || !report.s3Key)
      throw new PreconditionFailedError('Report is not ready for download');
    // The key is read from the tenant's own record, never from client input.
    const url = await this.artifacts.getDownloadUrl(report.s3Key, {
      expiresInSeconds: DOWNLOAD_TTL_SECONDS,
      filename: `${report.reportId}.${report.format === 'PDF' ? 'pdf' : 'json'}`,
      contentType: report.format === 'PDF' ? 'application/pdf' : 'application/json',
    });
    this.ctx.logger.audit('report.downloaded', { tenantId: auth.tenantId, userId: auth.userId, reportId });
    return {
      url,
      expiresAt: new Date(this.ctx.clock.now().getTime() + DOWNLOAD_TTL_SECONDS * 1000).toISOString(),
    };
  }
}
