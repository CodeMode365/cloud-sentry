import {
  GetCostAndUsageCommand,
  GetCostAndUsageWithResourcesCommand,
  type CostExplorerClient,
  type GetCostAndUsageCommandInput,
  type ResultByTime,
} from '@aws-sdk/client-cost-explorer';
import type {
  CostAvailability,
  CostSnapshot,
  DailyCostPoint,
  DimensionCost,
  MonthlyCostPoint,
  ResourceLevelCost,
} from '@cloudsentry/shared-types';
import {
  addDays,
  addUtcMonths,
  awsErrorName,
  errorMessage,
  isoDate,
  roundMoney,
  startOfUtcMonth,
  type Logger,
} from '@cloudsentry/utilities';

/**
 * Cost Explorer integration. IMPORTANT: every Cost Explorer API request is billed (USD 0.01 per request,
 * including each pagination page). A full snapshot issues 4 core requests (+1 when resource-level data is
 * enabled); callers must reuse snapshots (see COST_REFRESH_HOURS) rather than querying on every scan.
 *
 * All amounts are ACTUAL costs reported by AWS (UnblendedCost). Periods that AWS has not finalized are
 * flagged `unfinalized` (Cost Explorer's `Estimated` flag). CloudSentry never estimates billed cost here.
 */

export const COST_METRIC = 'UnblendedCost';
export const EC2_COMPUTE_SERVICE = 'Amazon Elastic Compute Cloud - Compute';

export interface FetchCostSnapshotOptions {
  now: Date;
  /** Number of full months before the current month to include in the monthly trend. */
  months: number;
  includeResourceLevel: boolean;
  logger: Logger;
}

export type CostSnapshotData = Omit<CostSnapshot, 'tenantId' | 'accountId' | 'scanId'>;

export interface CostQueryRanges {
  today: string;
  /** Exclusive end used for every range that should include today. */
  endExclusive: string;
  currentMonthStart: string;
  previousMonthStart: string;
  trendStart: string;
  resourceLevelStart: string;
}

/**
 * Cost Explorer's End date is exclusive. Ranges ending "today" use tomorrow as End, which also keeps
 * Start < End on the first day of a month. Resource-level data is limited to the last 14 days.
 */
export function computeRanges(now: Date, months: number): CostQueryRanges {
  const monthStart = startOfUtcMonth(now);
  return {
    today: isoDate(now),
    endExclusive: isoDate(addDays(now, 1)),
    currentMonthStart: isoDate(monthStart),
    previousMonthStart: isoDate(addUtcMonths(monthStart, -1)),
    trendStart: isoDate(addUtcMonths(monthStart, -months)),
    resourceLevelStart: isoDate(addDays(now, -13)),
  };
}

interface QueryError {
  query: string;
  code: string;
  message: string;
}

function amountOf(metrics: Record<string, { Amount?: string; Unit?: string }> | undefined): {
  amount: number;
  unit: string | null;
} {
  const metric = metrics?.[COST_METRIC];
  const parsed = metric?.Amount !== undefined ? Number.parseFloat(metric.Amount) : 0;
  return { amount: Number.isFinite(parsed) ? parsed : 0, unit: metric?.Unit ?? null };
}

async function getAllPages(
  ce: CostExplorerClient,
  input: GetCostAndUsageCommandInput,
  counter: { calls: number },
): Promise<ResultByTime[]> {
  const results: ResultByTime[] = [];
  let token: string | undefined;
  do {
    counter.calls++;
    const out = await ce.send(new GetCostAndUsageCommand({ ...input, NextPageToken: token }));
    results.push(...(out.ResultsByTime ?? []));
    token = out.NextPageToken;
  } while (token);
  return results;
}

function aggregateGroups(results: ResultByTime[], units: Set<string>): DimensionCost[] {
  const totals = new Map<string, number>();
  for (const r of results) {
    for (const g of r.Groups ?? []) {
      const key = g.Keys?.[0] ?? 'Unknown';
      const { amount, unit } = amountOf(g.Metrics);
      if (unit) units.add(unit);
      totals.set(key, (totals.get(key) ?? 0) + amount);
    }
  }
  return [...totals.entries()]
    .map(([key, amount]) => ({ key, amount: roundMoney(amount) }))
    .filter((d) => d.amount !== 0)
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
}

export function describeCostError(code: string, message: string): string {
  switch (code) {
    case 'AccessDeniedException':
    case 'AccessDenied':
      return 'Cost Explorer access denied or not enabled for this account';
    case 'DataUnavailableException':
      return 'Cost Explorer data is not available yet (Cost Explorer may have been enabled recently)';
    case 'BillExpirationException':
      return 'Requested billing period has expired from Cost Explorer';
    default:
      return `${code}: ${message}`;
  }
}

export async function fetchCostSnapshot(
  ce: CostExplorerClient,
  opts: FetchCostSnapshotOptions,
): Promise<CostSnapshotData> {
  const ranges = computeRanges(opts.now, opts.months);
  const errors: QueryError[] = [];
  const units = new Set<string>();
  const counter = { calls: 0 };
  const coreStatus: boolean[] = [];

  const run = async <T>(query: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      const value = await fn();
      return value;
    } catch (error) {
      const code = awsErrorName(error) ?? 'UnknownError';
      errors.push({ query, code, message: errorMessage(error) });
      opts.logger.warn('Cost Explorer query failed', { query, errorCode: code });
      return null;
    }
  };

  // Queries run sequentially: Cost Explorer has low request-rate limits.
  const monthlyResults = await run('monthlyTrend', () =>
    getAllPages(
      ce,
      {
        TimePeriod: { Start: ranges.trendStart, End: ranges.endExclusive },
        Granularity: 'MONTHLY',
        Metrics: [COST_METRIC],
      },
      counter,
    ),
  );
  coreStatus.push(monthlyResults !== null);

  const dailyResults = await run('daily', () =>
    getAllPages(
      ce,
      {
        TimePeriod: { Start: ranges.previousMonthStart, End: ranges.endExclusive },
        Granularity: 'DAILY',
        Metrics: [COST_METRIC],
      },
      counter,
    ),
  );
  coreStatus.push(dailyResults !== null);

  const serviceResults = await run('services', () =>
    getAllPages(
      ce,
      {
        TimePeriod: { Start: ranges.currentMonthStart, End: ranges.endExclusive },
        Granularity: 'MONTHLY',
        Metrics: [COST_METRIC],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      },
      counter,
    ),
  );
  coreStatus.push(serviceResults !== null);

  const regionResults = await run('regions', () =>
    getAllPages(
      ce,
      {
        TimePeriod: { Start: ranges.currentMonthStart, End: ranges.endExclusive },
        Granularity: 'MONTHLY',
        Metrics: [COST_METRIC],
        GroupBy: [{ Type: 'DIMENSION', Key: 'REGION' }],
      },
      counter,
    ),
  );
  coreStatus.push(regionResults !== null);

  const monthlyTrend: MonthlyCostPoint[] = (monthlyResults ?? []).map((r) => {
    const { amount, unit } = amountOf(r.Total);
    if (unit) units.add(unit);
    return {
      month: (r.TimePeriod?.Start ?? '').slice(0, 7),
      amount: roundMoney(amount),
      unfinalized: r.Estimated ?? false,
    };
  });

  const daily: DailyCostPoint[] = (dailyResults ?? []).map((r) => {
    const { amount, unit } = amountOf(r.Total);
    if (unit) units.add(unit);
    return { date: r.TimePeriod?.Start ?? '', amount: roundMoney(amount), unfinalized: r.Estimated ?? false };
  });

  const services = serviceResults ? aggregateGroups(serviceResults, units) : [];
  const regions = regionResults ? aggregateGroups(regionResults, units) : [];

  const currentMonthKey = ranges.currentMonthStart.slice(0, 7);
  const previousMonthKey = ranges.previousMonthStart.slice(0, 7);
  const dayOfMonth = Number(ranges.today.slice(8, 10));

  const sumDaily = (predicate: (p: DailyCostPoint) => boolean) => {
    const points = daily.filter(predicate);
    return points.length === 0
      ? null
      : {
          amount: roundMoney(points.reduce((s, p) => s + p.amount, 0)),
          unfinalized: points.some((p) => p.unfinalized),
        };
  };

  const currentFromTrend = monthlyTrend.find((m) => m.month === currentMonthKey);
  const previousFromTrend = monthlyTrend.find((m) => m.month === previousMonthKey);
  const currentAmount = currentFromTrend
    ? { amount: currentFromTrend.amount, unfinalized: currentFromTrend.unfinalized }
    : sumDaily((p) => p.date.startsWith(currentMonthKey));
  const previousAmount = previousFromTrend
    ? { amount: previousFromTrend.amount, unfinalized: previousFromTrend.unfinalized }
    : sumDaily((p) => p.date.startsWith(previousMonthKey));
  // Derived from the daily series (no extra billed request): previous month, days 1..today's day-of-month.
  const previousMonthToDate = sumDaily(
    (p) => p.date.startsWith(previousMonthKey) && Number(p.date.slice(8, 10)) <= dayOfMonth,
  );

  let resourceLevel: CostSnapshotData['resourceLevel'] = {
    availability: 'UNAVAILABLE',
    reason: 'Resource-level cost data is not enabled for this account in CloudSentry',
    items: [],
  };
  if (opts.includeResourceLevel) {
    resourceLevel = await fetchResourceLevel(ce, ranges, counter, errors);
  }

  const succeeded = coreStatus.filter(Boolean).length;
  const availability: CostAvailability =
    succeeded === 0 ? 'UNAVAILABLE' : succeeded < coreStatus.length ? 'PARTIAL' : 'AVAILABLE';
  const firstCoreError = errors.find((e) => e.query !== 'resourceLevel');

  opts.logger.info('Cost Explorer snapshot retrieved', {
    availability,
    billedRequests: counter.calls,
    failedQueries: errors.map((e) => e.query),
  });

  return {
    currency: [...units][0] ?? 'USD',
    source: 'AWS_COST_EXPLORER',
    costMetric: COST_METRIC,
    availability,
    unavailableReason:
      availability === 'AVAILABLE' || !firstCoreError
        ? null
        : describeCostError(firstCoreError.code, firstCoreError.message),
    retrievedAt: opts.now.toISOString(),
    currentMonth: currentAmount
      ? { ...currentAmount, start: ranges.currentMonthStart, end: ranges.today }
      : null,
    previousMonth: previousAmount
      ? {
          ...previousAmount,
          start: ranges.previousMonthStart,
          end: isoDate(addDays(new Date(`${ranges.currentMonthStart}T00:00:00Z`), -1)),
        }
      : null,
    previousMonthToDate,
    monthlyTrend,
    daily,
    services,
    regions,
    resourceLevel,
    errors,
  };
}

async function fetchResourceLevel(
  ce: CostExplorerClient,
  ranges: CostQueryRanges,
  counter: { calls: number },
  errors: QueryError[],
): Promise<CostSnapshotData['resourceLevel']> {
  try {
    const totals = new Map<string, number>();
    let token: string | undefined;
    do {
      counter.calls++;
      const out = await ce.send(
        new GetCostAndUsageWithResourcesCommand({
          TimePeriod: { Start: ranges.resourceLevelStart, End: ranges.endExclusive },
          Granularity: 'DAILY',
          Metrics: [COST_METRIC],
          Filter: { Dimensions: { Key: 'SERVICE', Values: [EC2_COMPUTE_SERVICE] } },
          GroupBy: [{ Type: 'DIMENSION', Key: 'RESOURCE_ID' }],
          NextPageToken: token,
        }),
      );
      for (const r of out.ResultsByTime ?? []) {
        for (const g of r.Groups ?? []) {
          const id = g.Keys?.[0];
          if (!id) continue;
          totals.set(id, (totals.get(id) ?? 0) + amountOf(g.Metrics).amount);
        }
      }
      token = out.NextPageToken;
    } while (token);
    const items: ResourceLevelCost[] = [...totals.entries()]
      .map(([resourceId, amount]) => ({
        resourceId,
        service: EC2_COMPUTE_SERVICE,
        amount: roundMoney(amount),
      }))
      .sort((a, b) => b.amount - a.amount);
    return {
      availability: 'AVAILABLE',
      reason: `Amounts are actual EC2 compute costs for ${ranges.resourceLevelStart} to ${ranges.today} (Cost Explorer resource-level window is 14 days)`,
      items,
    };
  } catch (error) {
    const code = awsErrorName(error) ?? 'UnknownError';
    errors.push({ query: 'resourceLevel', code, message: errorMessage(error) });
    const reason =
      code === 'DataUnavailableException' || code === 'ValidationException'
        ? 'Resource-level cost data requires opting in to hourly and resource-level granularity in Cost Explorer settings'
        : describeCostError(code, errorMessage(error));
    return { availability: 'UNAVAILABLE', reason, items: [] };
  }
}
