import type { Repositories } from '@cloudsentry/database';
import type {
  CloudAccount,
  FindingRecord,
  RecommendationRecord,
  ReportRecord,
  ResourceType,
  ScanExecution,
  Severity,
  Tenant,
} from '@cloudsentry/shared-types';
import { roundMoney } from '@cloudsentry/utilities';

export interface ReportData {
  report: Pick<
    ReportRecord,
    'reportId' | 'title' | 'type' | 'format' | 'periodStart' | 'periodEnd' | 'accountId'
  >;
  generatedAt: string;
  tenant: Pick<Tenant, 'tenantId' | 'name'>;
  accounts: Pick<
    CloudAccount,
    'accountId' | 'alias' | 'status' | 'dataSource' | 'regions' | 'lastSuccessfulScanAt'
  >[];
  inventory: {
    total: number;
    byType: { resourceType: ResourceType; count: number }[];
    byRegion: { region: string; count: number }[];
  };
  costs: {
    /** Actual billed cost from AWS Cost Explorer (month-to-date; may be unfinalized). */
    currentMonthToDate: number | null;
    previousMonth: number | null;
    currency: string;
    topServices: { key: string; amount: number }[];
    accountsWithoutCostData: string[];
  };
  findings: { active: number; bySeverity: Record<Severity, number>; top: FindingRecord[] };
  savings: {
    /** Estimates, not guaranteed. */
    potentialMonthly: number;
    potentialAnnual: number;
    acceptedMonthly: number;
    realizedMonthlyEstimate: number;
    unpriced: number;
    top: RecommendationRecord[];
  };
  scans: Pick<
    ScanExecution,
    'scanId' | 'accountId' | 'trigger' | 'status' | 'requestedAt' | 'durationMs' | 'summary'
  >[];
  disclaimers: string[];
}

const ACTIVE = new Set(['OPEN', 'ACKNOWLEDGED']);
const POTENTIAL = new Set(['OPEN', 'UNDER_REVIEW', 'ACCEPTED']);

/** Gathers report content strictly from the tenant's persisted records (no fabricated values). */
export async function assembleReportData(
  repos: Repositories,
  report: ReportRecord,
  now: Date,
): Promise<ReportData> {
  const t = report.tenantId;
  const scope = report.accountId ? { accountId: report.accountId } : {};
  const [tenant, accounts, resources, findings, recs, costs, scans] = await Promise.all([
    repos.tenants.getTenant(t),
    repos.accounts.list(t),
    repos.resources.listAll(t, scope, 20_000),
    repos.findings.listAll(t, scope),
    repos.recommendations.listAll(t, scope),
    repos.costs.list(t),
    repos.scans.listRecent(t, 100),
  ]);
  const scopedAccounts = report.accountId
    ? accounts.filter((a) => a.accountId === report.accountId)
    : accounts;
  const scopedCosts = costs.filter(
    (c) => scopedAccounts.some((a) => a.accountId === c.accountId) && c.availability !== 'UNAVAILABLE',
  );
  const count = <K extends string>(items: K[]) => {
    const m = new Map<K, number>();
    for (const k of items) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const activeFindings = findings.filter((f) => ACTIVE.has(f.status));
  const bySeverity: Record<Severity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const f of activeFindings) bySeverity[f.severity]++;
  const potential = recs.filter((r) => POTENTIAL.has(r.status));
  const potentialMonthly = roundMoney(potential.reduce((s, r) => s + (r.estimatedMonthlySavings ?? 0), 0));
  const services = new Map<string, number>();
  for (const c of scopedCosts)
    for (const s of c.services) services.set(s.key, (services.get(s.key) ?? 0) + s.amount);
  const severityRank: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return {
    report: {
      reportId: report.reportId,
      title: report.title,
      type: report.type,
      format: report.format,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      accountId: report.accountId,
    },
    generatedAt: now.toISOString(),
    tenant: { tenantId: t, name: tenant?.name ?? t },
    accounts: scopedAccounts.map((a) => ({
      accountId: a.accountId,
      alias: a.alias,
      status: a.status,
      dataSource: a.dataSource,
      regions: a.regions,
      lastSuccessfulScanAt: a.lastSuccessfulScanAt,
    })),
    inventory: {
      total: resources.filter((r) => r.lifecycleStatus === 'ACTIVE').length,
      byType: count(resources.filter((r) => r.lifecycleStatus === 'ACTIVE').map((r) => r.resourceType)).map(
        ([resourceType, c]) => ({ resourceType, count: c }),
      ),
      byRegion: count(resources.filter((r) => r.lifecycleStatus === 'ACTIVE').map((r) => r.region)).map(
        ([region, c]) => ({ region, count: c }),
      ),
    },
    costs: {
      currentMonthToDate: scopedCosts.length
        ? roundMoney(scopedCosts.reduce((s, c) => s + (c.currentMonth?.amount ?? 0), 0))
        : null,
      previousMonth: scopedCosts.length
        ? roundMoney(scopedCosts.reduce((s, c) => s + (c.previousMonth?.amount ?? 0), 0))
        : null,
      currency: scopedCosts[0]?.currency ?? 'USD',
      topServices: [...services.entries()]
        .map(([key, amount]) => ({ key, amount: roundMoney(amount) }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
      accountsWithoutCostData: scopedAccounts
        .filter((a) => !scopedCosts.some((c) => c.accountId === a.accountId))
        .map((a) => a.accountId),
    },
    findings: {
      active: activeFindings.length,
      bySeverity,
      top: [...activeFindings]
        .sort(
          (a, b) =>
            severityRank[a.severity] - severityRank[b.severity] ||
            (b.estimatedMonthlySavings ?? 0) - (a.estimatedMonthlySavings ?? 0),
        )
        .slice(0, 50),
    },
    savings: {
      potentialMonthly,
      potentialAnnual: roundMoney(potentialMonthly * 12),
      acceptedMonthly: roundMoney(
        recs.filter((r) => r.status === 'ACCEPTED').reduce((s, r) => s + (r.estimatedMonthlySavings ?? 0), 0),
      ),
      realizedMonthlyEstimate: roundMoney(
        recs.reduce((s, r) => s + (r.realizedMonthlySavingsEstimate ?? 0), 0),
      ),
      unpriced: potential.filter((r) => r.estimatedMonthlySavings === null).length,
      top: [...potential]
        .filter((r) => r.estimatedMonthlySavings !== null)
        .sort((a, b) => (b.estimatedMonthlySavings ?? 0) - (a.estimatedMonthlySavings ?? 0))
        .slice(0, 50),
    },
    scans: scans
      .filter(
        (s) => (!report.accountId || s.accountId === report.accountId) && s.requestedAt >= report.periodStart,
      )
      .slice(0, 20)
      .map((s) => ({
        scanId: s.scanId,
        accountId: s.accountId,
        trigger: s.trigger,
        status: s.status,
        requestedAt: s.requestedAt,
        durationMs: s.durationMs,
        summary: s.summary,
      })),
    disclaimers: [
      'Spend figures are actual costs reported by AWS Cost Explorer; current-period figures may be unfinalized.',
      'Savings figures are estimates based on AWS Price List on-demand prices. They are not guaranteed and do not account for Reserved Instances, Savings Plans, credits or negotiated discounts.',
      'CloudSentry is read-only and has not modified any resource. All suggested actions require human review.',
      ...(scopedAccounts.some((a) => a.dataSource === 'SYNTHETIC')
        ? ['This report includes SYNTHETIC local-development data that does not describe real AWS resources.']
        : []),
    ],
  };
}
