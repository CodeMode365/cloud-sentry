import type { ArtifactStore } from '@cloudsentry/aws-clients';
import type { Repositories } from '@cloudsentry/database';
import type { ReportRecord } from '@cloudsentry/shared-types';
import { errorMessage, NotFoundError, type Logger } from '@cloudsentry/utilities';
import { assembleReportData } from './data';
import { renderPdf } from './pdf';

export interface GenerateReportDeps {
  repos: Repositories;
  artifacts: ArtifactStore;
  logger: Logger;
  now: () => Date;
}

/** Generates a report and stores it in S3. Safe to retry: a READY report is not regenerated. */
export async function generateReport(
  deps: GenerateReportDeps,
  request: { tenantId: string; reportId: string },
): Promise<ReportRecord> {
  const report = await deps.repos.reports.get(request.tenantId, request.reportId);
  if (!report) throw new NotFoundError('Report', request.reportId);
  if (report.status === 'READY') return report;
  if (!report.s3Key) throw new Error('Report has no storage key');
  await deps.repos.reports.update(request.tenantId, request.reportId, { status: 'GENERATING' });
  try {
    const data = await assembleReportData(deps.repos, report, deps.now());
    const body = report.format === 'PDF' ? await renderPdf(data) : JSON.stringify(data, null, 2);
    const { sizeBytes } = await deps.artifacts.putObject(
      report.s3Key,
      body,
      report.format === 'PDF' ? 'application/pdf' : 'application/json',
    );
    const done = await deps.repos.reports.update(request.tenantId, request.reportId, {
      status: 'READY',
      sizeBytes,
      completedAt: deps.now().toISOString(),
      error: null,
    });
    deps.logger.info('Report generated', { reportId: report.reportId, sizeBytes, format: report.format });
    return done;
  } catch (error) {
    deps.logger.error('Report generation failed', { reportId: report.reportId, error });
    return deps.repos.reports.update(request.tenantId, request.reportId, {
      status: 'FAILED',
      error: errorMessage(error).slice(0, 500),
    });
  }
}
