import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSystemArtifactStore } from '@cloudsentry/aws-clients';
import { generateReport, pdfSafe } from '@cloudsentry/reporting';
import type { ReportRecord } from '@cloudsentry/shared-types';
import { ARTIFACT_KEYS } from '@cloudsentry/shared-types';
import { silentLogger } from '@cloudsentry/utilities';
import { available, freshRepositories } from '../helpers/ddb';
import { account, seedTenant } from '../helpers/fixtures';

describe.skipIf(!available)('report generation', () => {
  it('renders a PDF from persisted data and marks the report READY', async () => {
    const repos = await freshRepositories('reports');
    await seedTenant(repos, 'ten_R', 'owner');
    await repos.accounts.create(account('ten_R', '123456789012', { alias: 'Prod — “main”' }));
    const dir = mkdtempSync(join(tmpdir(), 'cs-rpt-'));
    const artifacts = new FileSystemArtifactStore(dir, 'secret', 'http://localhost');
    const now = new Date().toISOString();
    const report: ReportRecord = {
      reportId: 'rpt_01JABCDEFGHJKMNPQRSTVWXYZ0',
      tenantId: 'ten_R',
      accountId: null,
      type: 'ON_DEMAND',
      format: 'PDF',
      status: 'PENDING',
      title: 'Test report',
      periodStart: now,
      periodEnd: now,
      s3Key: ARTIFACT_KEYS.report('ten_R', 'all', 'ON_DEMAND', 'rpt_01JABCDEFGHJKMNPQRSTVWXYZ0', 'pdf'),
      sizeBytes: null,
      requestedBy: 'owner',
      error: null,
      createdAt: now,
      completedAt: null,
      updatedAt: now,
      version: 1,
    };
    await repos.reports.create(report);
    const done = await generateReport(
      { repos, artifacts, logger: silentLogger, now: () => new Date() },
      { tenantId: 'ten_R', reportId: report.reportId },
    );
    expect(done.status).toBe('READY');
    const bytes = readFileSync(join(dir, report.s3Key as string));
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(done.sizeBytes).toBe(bytes.length);
    expect(pdfSafe('Prod — “main” ✓')).toBe('Prod - "main" ?');
  });
});
