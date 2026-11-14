import type { ReportFormat, ReportStatus, ReportType } from './enums';

export interface ReportRecord {
  reportId: string;
  tenantId: string;
  /** null = all accounts in the tenant. */
  accountId: string | null;
  type: ReportType;
  format: ReportFormat;
  status: ReportStatus;
  title: string;
  periodStart: string;
  periodEnd: string;
  s3Key: string | null;
  sizeBytes: number | null;
  requestedBy: string;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
  version: number;
}
