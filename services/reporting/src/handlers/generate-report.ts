import { createWorkerBase, type WorkerBase } from '@cloudsentry/core';
import type { ReportRecord } from '@cloudsentry/shared-types';
import { generateReport } from '../generate';

let base: WorkerBase | undefined;

export async function handler(event: {
  tenantId: string;
  reportId: string;
}): Promise<Pick<ReportRecord, 'reportId' | 'status'>> {
  base ??= createWorkerBase('cloudsentry-reporting');
  const logger = base.logger.child({ tenantId: event.tenantId, reportId: event.reportId });
  const out = await generateReport(
    { repos: base.repos, artifacts: base.artifacts, logger, now: () => new Date() },
    event,
  );
  return { reportId: out.reportId, status: out.status };
}
