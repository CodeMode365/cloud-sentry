import {
  GetMetricDataCommand,
  type CloudWatchClient,
  type MetricDataQuery,
  type MetricDataResult,
} from '@aws-sdk/client-cloudwatch';
import type {
  DiscoveredResource,
  MetricSeriesSummary,
  MetricStatistics,
  RegionError,
  ResourceUtilization,
} from '@cloudsentry/shared-types';
import {
  awsErrorName,
  errorMessage,
  maxOf,
  mean,
  minOf,
  MS_PER_DAY,
  percentile,
  resourceKeyFor,
  round,
  sum,
  type Logger,
} from '@cloudsentry/utilities';
import { metricQueriesFor, metricsRegionFor, type MetricQuery } from './catalog';

/** GetMetricData limits: 500 queries per request, 100,800 datapoints per response page. */
export const MAX_QUERIES_PER_REQUEST = 500;
export const MAX_DATAPOINTS_PER_REQUEST = 100_800;

export interface CollectUtilizationOptions {
  lookbackDays: number;
  now: Date;
  /** CloudWatch period. 3600 keeps 30-day windows within CloudWatch's 1-hour retention (455 days). */
  periodSeconds?: number;
  logger: Logger;
}

export interface CollectUtilizationResult {
  utilization: Map<string, ResourceUtilization>;
  regionErrors: RegionError[];
  apiCalls: number;
}

interface PlannedQuery {
  id: string;
  resourceKey: string;
  query: MetricQuery;
  resource: DiscoveredResource;
}

/** Splits queries into GetMetricData batches respecting both the query and the datapoint limits. */
export function batchSizeFor(pointsPerQuery: number): number {
  const byPoints = Math.floor(MAX_DATAPOINTS_PER_REQUEST / Math.max(1, pointsPerQuery));
  return Math.max(1, Math.min(MAX_QUERIES_PER_REQUEST, byPoints));
}

export function summarizeValues(values: readonly number[], expectedDatapoints: number): MetricStatistics {
  const r = (v: number | null) => (v === null ? null : round(v, 4));
  return {
    average: r(mean(values)),
    minimum: r(minOf(values)),
    maximum: r(maxOf(values)),
    p50: r(percentile(values, 50)),
    p95: r(percentile(values, 95)),
    p99: r(percentile(values, 99)),
    sum: round(sum(values), 4),
    datapoints: values.length,
    expectedDatapoints,
    coverage: expectedDatapoints > 0 ? Math.min(1, round(values.length / expectedDatapoints, 4)) : 0,
    zeroFraction: values.length > 0 ? round(values.filter((v) => v === 0).length / values.length, 4) : null,
  };
}

/** Days of history a resource can have within the lookback window (bounded by its creation time). */
export function observableDaysFor(createdAt: string | null, lookbackDays: number, now: Date): number {
  if (!createdAt) return lookbackDays;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return lookbackDays;
  const ageDays = (now.getTime() - created) / MS_PER_DAY;
  return Math.max(0, Math.min(lookbackDays, round(ageDays, 2)));
}

function floorToPeriod(date: Date, periodSeconds: number): Date {
  const ms = periodSeconds * 1000;
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

/**
 * Collects CloudWatch utilization for qualifying resources using batched GetMetricData requests.
 * Missing data is reported as NO_DATA (never zero); a failing region marks its metrics as ERROR.
 *
 * Queries come from `metricQueriesFor` (catalog). Resources are grouped by `metricsRegionFor`, so global
 * resources (CloudFront, region `global`) are queried with the us-east-1 CloudWatch client while their
 * utilization stays keyed by their own resourceKey; region errors name the CloudWatch region.
 */
export async function collectUtilization(
  resources: readonly DiscoveredResource[],
  clients: { cloudwatch(region: string): CloudWatchClient },
  opts: CollectUtilizationOptions,
): Promise<CollectUtilizationResult> {
  const periodSeconds = opts.periodSeconds ?? 3600;
  const endTime = floorToPeriod(opts.now, periodSeconds);
  const startTime = new Date(endTime.getTime() - opts.lookbackDays * MS_PER_DAY);
  const pointsPerQuery = Math.ceil((endTime.getTime() - startTime.getTime()) / (periodSeconds * 1000));
  const batchSize = batchSizeFor(pointsPerQuery);
  const collectedAt = opts.now.toISOString();

  const byRegion = new Map<string, { resource: DiscoveredResource; queries: MetricQuery[] }[]>();
  for (const resource of resources) {
    const queries = metricQueriesFor(resource);
    if (queries.length === 0) continue;
    const region = metricsRegionFor(resource);
    const list = byRegion.get(region) ?? [];
    list.push({ resource, queries });
    byRegion.set(region, list);
  }

  const utilization = new Map<string, ResourceUtilization>();
  const regionErrors: RegionError[] = [];
  let apiCalls = 0;

  for (const [region, regionResources] of byRegion) {
    const planned: PlannedQuery[] = [];
    for (const { resource, queries } of regionResources) {
      const resourceKey = resourceKeyFor(
        resource.accountId,
        resource.region,
        resource.resourceType,
        resource.resourceId,
      );
      for (const query of queries) {
        planned.push({ id: `m${planned.length}`, resourceKey, query, resource });
      }
    }

    const values = new Map<string, number[]>();
    const statusErrors = new Map<string, string>();
    const failedIds = new Map<string, string>();
    const cw = clients.cloudwatch(region);
    let regionFailure: string | null = null;

    for (let i = 0; i < planned.length; i += batchSize) {
      const batch = planned.slice(i, i + batchSize);
      if (regionFailure) {
        for (const q of batch) failedIds.set(q.id, regionFailure);
        continue;
      }
      const queries: MetricDataQuery[] = batch.map((q) => ({
        Id: q.id,
        ReturnData: true,
        MetricStat: {
          Metric: {
            Namespace: q.query.namespace,
            MetricName: q.query.metricName,
            Dimensions: q.query.dimensions.map((d) => ({ Name: d.name, Value: d.value })),
          },
          Period: periodSeconds,
          Stat: q.query.stat,
        },
      }));
      try {
        let nextToken: string | undefined;
        do {
          apiCalls++;
          const out = await cw.send(
            new GetMetricDataCommand({
              StartTime: startTime,
              EndTime: endTime,
              ScanBy: 'TimestampAscending',
              MetricDataQueries: queries,
              NextToken: nextToken,
            }),
          );
          for (const result of out.MetricDataResults ?? []) accumulate(result, values, statusErrors);
          nextToken = out.NextToken;
        } while (nextToken);
      } catch (error) {
        const errorCode = awsErrorName(error) ?? 'UnknownError';
        regionFailure = `${errorCode}: ${errorMessage(error)}`;
        regionErrors.push({ region, errorCode, message: errorMessage(error) });
        opts.logger.warn('CloudWatch metric collection failed for region', { region, errorCode });
        for (const q of batch) failedIds.set(q.id, regionFailure);
      }
    }

    for (const q of planned) {
      const observableDays = observableDaysFor(q.resource.createdAt, opts.lookbackDays, endTime);
      const expected = Math.floor((observableDays * 86_400) / periodSeconds);
      let util = utilization.get(q.resourceKey);
      if (!util) {
        util = {
          lookbackDays: opts.lookbackDays,
          periodStart: startTime.toISOString(),
          periodEnd: endTime.toISOString(),
          collectedAt,
          observableDays,
          metrics: {},
        };
        utilization.set(q.resourceKey, util);
      }
      const base = {
        namespace: q.query.namespace,
        metricName: q.query.metricName,
        statistic: q.query.stat,
        periodSeconds,
        unit: q.query.unit,
      };
      let summary: MetricSeriesSummary;
      const failure = failedIds.get(q.id) ?? statusErrors.get(q.id);
      const scale = q.query.scale ?? 1;
      const series = (values.get(q.id) ?? []).map((v) => v * scale);
      if (failure) {
        summary = { ...base, availability: 'ERROR', stats: null, error: failure };
      } else if (series.length === 0) {
        summary = { ...base, availability: 'NO_DATA', stats: null };
      } else {
        summary = { ...base, availability: 'AVAILABLE', stats: summarizeValues(series, expected) };
      }
      util.metrics[q.query.key] = summary;
    }

    opts.logger.info('CloudWatch metrics collected for region', {
      region,
      resources: regionResources.length,
      queries: planned.length,
      failed: failedIds.size,
    });
  }

  return { utilization, regionErrors, apiCalls };
}

function accumulate(
  result: MetricDataResult,
  values: Map<string, number[]>,
  statusErrors: Map<string, string>,
): void {
  if (!result.Id) return;
  if (result.StatusCode === 'Forbidden' || result.StatusCode === 'InternalError') {
    statusErrors.set(result.Id, `GetMetricData status ${result.StatusCode}`);
    return;
  }
  const list = values.get(result.Id) ?? [];
  for (const v of result.Values ?? []) {
    if (Number.isFinite(v)) list.push(v);
  }
  values.set(result.Id, list);
}
