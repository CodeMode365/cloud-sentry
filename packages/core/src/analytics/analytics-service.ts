import type {
  AuthContext,
  CostAnalytics,
  CostSnapshot,
  DailyCostPoint,
  DimensionCost,
  MonthlyCostPoint,
  OverviewAnalytics,
  RecommendationRecord,
  ResourceAnalytics,
  ResourceType,
  SavingsAnalytics,
  Severity,
} from '@cloudsentry/shared-types';
import { detectDailyAnomalies, isoDate, roundMoney, startOfUtcMonth } from '@cloudsentry/utilities';
import type { ServiceContext } from '../context';

const POTENTIAL_STATUSES = new Set(['OPEN', 'UNDER_REVIEW', 'ACCEPTED']);

function mergeDimension(lists: DimensionCost[][], top = 25): DimensionCost[] {
  const totals = new Map<string, number>();
  for (const list of lists) for (const d of list) totals.set(d.key, (totals.get(d.key) ?? 0) + d.amount);
  return [...totals.entries()]
    .map(([key, amount]) => ({ key, amount: roundMoney(amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, top);
}

function mergeMonthly(lists: MonthlyCostPoint[][]): MonthlyCostPoint[] {
  const m = new Map<string, MonthlyCostPoint>();
  for (const list of lists) {
    for (const p of list) {
      const prev = m.get(p.month);
      m.set(p.month, {
        month: p.month,
        amount: roundMoney((prev?.amount ?? 0) + p.amount),
        unfinalized: (prev?.unfinalized ?? false) || p.unfinalized,
      });
    }
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function mergeDaily(lists: DailyCostPoint[][]): DailyCostPoint[] {
  const m = new Map<string, DailyCostPoint>();
  for (const list of lists) {
    for (const p of list) {
      const prev = m.get(p.date);
      m.set(p.date, {
        date: p.date,
        amount: roundMoney((prev?.amount ?? 0) + p.amount),
        unfinalized: (prev?.unfinalized ?? false) || p.unfinalized,
      });
    }
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export class AnalyticsService {
  constructor(private readonly ctx: ServiceContext) {}

  private async snapshots(tenantId: string, accountId?: string): Promise<CostSnapshot[]> {
    const all = await this.ctx.repos.costs.list(tenantId);
    return accountId ? all.filter((s) => s.accountId === accountId) : all;
  }

  private async potentialRecommendations(
    tenantId: string,
    accountId?: string,
  ): Promise<RecommendationRecord[]> {
    const recs = await this.ctx.repos.recommendations.listAll(tenantId, accountId ? { accountId } : {});
    return recs.filter((r) => POTENTIAL_STATUSES.has(r.status));
  }

  async overview(auth: AuthContext, accountId?: string): Promise<OverviewAnalytics> {
    const t = auth.tenantId;
    const repos = this.ctx.repos;
    const [accounts, snapshots, resources, findings, recs, recentScans] = await Promise.all([
      repos.accounts.list(t),
      this.snapshots(t, accountId),
      repos.resources.listAll(t, accountId ? { accountId } : {}, 20_000),
      repos.findings.listAll(t, { statuses: ['OPEN', 'ACKNOWLEDGED'], ...(accountId ? { accountId } : {}) }),
      this.potentialRecommendations(t, accountId),
      repos.scans.listRecent(t, 25),
    ]);
    const withCost = snapshots.filter((s) => s.availability !== 'UNAVAILABLE' && s.currentMonth);
    const byType: Partial<Record<ResourceType, number>> = {};
    for (const r of resources) byType[r.resourceType] = (byType[r.resourceType] ?? 0) + 1;
    const bySeverity: Record<Severity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const f of findings) bySeverity[f.severity]++;
    const scopedAccounts = accountId ? accounts.filter((a) => a.accountId === accountId) : accounts;
    return {
      generatedAt: this.ctx.clock.now().toISOString(),
      accounts: {
        total: scopedAccounts.length,
        connected: scopedAccounts.filter((a) => a.status === 'CONNECTED').length,
        synthetic: scopedAccounts.filter((a) => a.dataSource === 'SYNTHETIC').length,
      },
      spend: {
        currentMonthToDate: withCost.length
          ? roundMoney(withCost.reduce((s, c) => s + (c.currentMonth?.amount ?? 0), 0))
          : null,
        previousMonth: withCost.length
          ? roundMoney(withCost.reduce((s, c) => s + (c.previousMonth?.amount ?? 0), 0))
          : null,
        currency: withCost[0]?.currency ?? 'USD',
        accountsWithCostData: withCost.length,
        accountsWithoutCostData: scopedAccounts.length - withCost.length,
        syntheticCostIncluded: withCost.some((s) => s.source === 'SYNTHETIC'),
      },
      potentialMonthlySavings: roundMoney(recs.reduce((s, r) => s + (r.estimatedMonthlySavings ?? 0), 0)),
      resources: { total: resources.length, byType },
      findings: { active: findings.length, critical: bySeverity.CRITICAL, bySeverity },
      recentScans: recentScans.filter((s) => !accountId || s.accountId === accountId).slice(0, 5),
      costTrend: mergeMonthly(withCost.map((s) => s.monthlyTrend)),
      serviceCosts: mergeDimension(
        withCost.map((s) => s.services),
        10,
      ),
      topOpportunities: [...recs]
        .filter((r) => r.estimatedMonthlySavings !== null)
        .sort((a, b) => (b.estimatedMonthlySavings ?? 0) - (a.estimatedMonthlySavings ?? 0))
        .slice(0, 5),
    };
  }

  async costs(
    auth: AuthContext,
    query: { accountId?: string | undefined; months: number },
  ): Promise<CostAnalytics> {
    const snapshots = await this.snapshots(auth.tenantId, query.accountId);
    const available = snapshots.filter((s) => s.availability !== 'UNAVAILABLE');
    const accounts = await this.ctx.repos.accounts.list(auth.tenantId);
    const scoped = query.accountId ? accounts.filter((a) => a.accountId === query.accountId) : accounts;
    const withSnapshot = new Map(snapshots.map((s) => [s.accountId, s]));
    const unavailableAccounts = scoped
      .filter(
        (a) =>
          withSnapshot.get(a.accountId)?.availability !== 'AVAILABLE' &&
          withSnapshot.get(a.accountId)?.availability !== 'PARTIAL',
      )
      .map((a) => ({
        accountId: a.accountId,
        reason: withSnapshot.get(a.accountId)?.unavailableReason ?? 'No cost data collected yet (run a scan)',
      }));

    const now = this.ctx.clock.now();
    const currentStart = isoDate(startOfUtcMonth(now));
    const previousStart = isoDate(
      startOfUtcMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))),
    );
    const daily = mergeDaily(available.map((s) => s.daily));
    const monthly = mergeMonthly(available.map((s) => s.monthlyTrend)).slice(-(query.months + 1));
    const current = daily.filter((d) => d.date >= currentStart);
    const previous = daily.filter((d) => d.date >= previousStart && d.date < currentStart);
    const sum = (pts: DailyCostPoint[]) => roundMoney(pts.reduce((s, p) => s + p.amount, 0));
    const mtd = available.length
      ? roundMoney(available.reduce((s, c) => s + (c.currentMonth?.amount ?? 0), 0))
      : null;
    const prevMtd = available.some((s) => s.previousMonthToDate)
      ? roundMoney(available.reduce((s, c) => s + (c.previousMonthToDate?.amount ?? 0), 0))
      : null;
    const prevTotal = available.length
      ? roundMoney(available.reduce((s, c) => s + (c.previousMonth?.amount ?? 0), 0))
      : null;
    const recs = await this.potentialRecommendations(auth.tenantId, query.accountId);
    const potentialMonthly = roundMoney(recs.reduce((s, r) => s + (r.estimatedMonthlySavings ?? 0), 0));
    const retrieved = available.map((s) => s.retrievedAt).sort();
    return {
      accountIds: scoped.map((a) => a.accountId),
      currency: available[0]?.currency ?? 'USD',
      availability:
        available.length === 0 ? 'UNAVAILABLE' : unavailableAccounts.length ? 'PARTIAL' : 'AVAILABLE',
      unavailableAccounts,
      retrievedAt: retrieved[0] ?? null,
      syntheticCostIncluded: available.some((s) => s.source === 'SYNTHETIC'),
      monthlyTrend: monthly,
      daily: current,
      previousMonthDaily: previous,
      services: mergeDimension(available.map((s) => s.services)),
      regions: mergeDimension(available.map((s) => s.regions)),
      monthOverMonth: {
        currentMonthToDate: mtd ?? (current.length ? sum(current) : null),
        previousMonthToDate: prevMtd,
        previousMonthTotal: prevTotal,
        changeAmount: mtd !== null && prevMtd !== null ? roundMoney(mtd - prevMtd) : null,
        changePercent: mtd !== null && prevMtd ? Math.round(((mtd - prevMtd) / prevMtd) * 1000) / 10 : null,
      },
      estimatedSavings: { potentialMonthly, potentialAnnual: roundMoney(potentialMonthly * 12) },
      anomalies: detectDailyAnomalies(daily),
    };
  }

  async resources(auth: AuthContext, accountId?: string): Promise<ResourceAnalytics> {
    const resources = await this.ctx.repos.resources.listAll(
      auth.tenantId,
      accountId ? { accountId } : {},
      20_000,
    );
    const count = <K extends string>(key: (r: (typeof resources)[number]) => K) => {
      const m = new Map<K, number>();
      for (const r of resources) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    return {
      total: resources.length,
      byType: count((r) => r.resourceType).map(([resourceType, c]) => ({ resourceType, count: c })),
      byRegion: count((r) => r.region).map(([region, c]) => ({ region, count: c })),
      byAccount: count((r) => r.accountId).map(([id, c]) => ({ accountId: id, count: c })),
      byState: count((r) => r.state).map(([state, c]) => ({ state, count: c })),
      withFindings: resources.filter((r) => r.activeFindingCount > 0).length,
    };
  }

  async savings(auth: AuthContext, accountId?: string): Promise<SavingsAnalytics> {
    const recs = await this.ctx.repos.recommendations.listAll(auth.tenantId, accountId ? { accountId } : {});
    const bucket = (statuses: string[]) => {
      const list = recs.filter((r) => statuses.includes(r.status));
      return {
        monthly: roundMoney(list.reduce((s, r) => s + (r.estimatedMonthlySavings ?? 0), 0)),
        count: list.length,
      };
    };
    const potentialList = recs.filter((r) => POTENTIAL_STATUSES.has(r.status));
    const group = <K extends string>(key: (r: RecommendationRecord) => K) => {
      const m = new Map<K, { monthly: number; count: number }>();
      for (const r of potentialList) {
        const g = m.get(key(r)) ?? { monthly: 0, count: 0 };
        g.monthly += r.estimatedMonthlySavings ?? 0;
        g.count++;
        m.set(key(r), g);
      }
      return [...m.entries()]
        .map(([k, v]) => ({ k, monthly: roundMoney(v.monthly), count: v.count }))
        .sort((a, b) => b.monthly - a.monthly);
    };
    const potential = bucket(['OPEN', 'UNDER_REVIEW', 'ACCEPTED']);
    const realized = recs.filter((r) => r.status === 'RESOLVED' && r.realizedMonthlySavingsEstimate !== null);
    return {
      currency: 'USD',
      potential: { ...potential, annual: roundMoney(potential.monthly * 12) },
      underReview: bucket(['UNDER_REVIEW']),
      accepted: bucket(['ACCEPTED']),
      realizedEstimate: {
        monthly: roundMoney(realized.reduce((s, r) => s + (r.realizedMonthlySavingsEstimate ?? 0), 0)),
        count: realized.length,
      },
      dismissed: bucket(['DISMISSED']),
      unpricedRecommendations: potentialList.filter((r) => r.estimatedMonthlySavings === null).length,
      byRule: group((r) => r.ruleId).map(({ k, ...v }) => ({ ruleId: k, ...v })),
      byResourceType: group((r) => r.resourceType).map(({ k, ...v }) => ({ resourceType: k, ...v })),
      byAccount: group((r) => r.accountId).map(({ k, ...v }) => ({ accountId: k, ...v })),
    };
  }
}
