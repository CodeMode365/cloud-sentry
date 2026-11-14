import {
  metricKey,
  type ConfidenceLevel,
  type EvidenceItem,
  type MetricSeriesSummary,
  type MetricStatisticName,
  type MetricStatistics,
  type NormalizedResource,
} from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';

/** Why a metric could not be used. Missing data is never coerced to zero. */
export type MetricFailureCode =
  | 'METRICS_NOT_COLLECTED'
  | 'METRIC_MISSING'
  | 'NO_DATA'
  | 'ERROR'
  | 'INSUFFICIENT_COVERAGE';

export type MetricFailure = { ok: false; reason: string; code: MetricFailureCode };

export type MetricRead = { ok: true; series: MetricSeriesSummary; stats: MetricStatistics } | MetricFailure;

export function insufficientCoverageReason(key: string, coverage: number, minCoverage: number): string {
  return `INSUFFICIENT_METRIC_COVERAGE: ${key} coverage ${round(coverage * 100, 1)}% < ${round(minCoverage * 100, 1)}%`;
}

/**
 * Reads one metric summary by its exact utilization key (e.g. "CPUUtilization:Average" or a qualified key
 * such as "ProvisionedConcurrencyUtilization:Maximum:live"). Missing or unavailable data is reported as a
 * reason - it is never treated as zero utilization. Coverage below `minCoverage` is also reported as unusable.
 */
export function readMetricByKey(resource: NormalizedResource, key: string, minCoverage: number): MetricRead {
  if (!resource.utilization) return { ok: false, code: 'METRICS_NOT_COLLECTED', reason: 'METRICS_NOT_COLLECTED' };
  const series = resource.utilization.metrics[key];
  if (!series) return { ok: false, code: 'METRIC_MISSING', reason: `METRIC_NOT_COLLECTED: ${key}` };
  if (series.availability !== 'AVAILABLE' || !series.stats) {
    const code: MetricFailureCode =
      series.availability === 'ERROR' ? 'ERROR' : series.availability === 'NO_DATA' ? 'NO_DATA' : 'METRIC_MISSING';
    return { ok: false, code, reason: `METRIC_${series.availability}: ${key}` };
  }
  if (series.stats.datapoints === 0) return { ok: false, code: 'NO_DATA', reason: `METRIC_NO_DATA: ${key}` };
  if (series.stats.coverage < minCoverage) {
    return {
      ok: false,
      code: 'INSUFFICIENT_COVERAGE',
      reason: insufficientCoverageReason(key, series.stats.coverage, minCoverage),
    };
  }
  return { ok: true, series, stats: series.stats };
}

/** Reads one metric summary keyed `${metricName}:${statistic}`. See {@link readMetricByKey}. */
export function readMetric(
  resource: NormalizedResource,
  metricName: string,
  statistic: MetricStatisticName,
  minCoverage: number,
): MetricRead {
  return readMetricByKey(resource, metricKey(metricName, statistic), minCoverage);
}

/** Reads several metrics; returns the first failure reason or all reads. */
export function readMetrics<T extends string>(
  resource: NormalizedResource,
  specs: Record<T, [metricName: string, statistic: MetricStatisticName]>,
  minCoverage: number,
): { ok: true; values: Record<T, { series: MetricSeriesSummary; stats: MetricStatistics }> } | MetricFailure {
  const values = {} as Record<T, { series: MetricSeriesSummary; stats: MetricStatistics }>;
  for (const [name, [metricName, statistic]] of Object.entries(specs) as [
    T,
    [string, MetricStatisticName],
  ][]) {
    const read = readMetric(resource, metricName, statistic, minCoverage);
    if (!read.ok) return read;
    values[name] = { series: read.series, stats: read.stats };
  }
  return { ok: true, values };
}

/** True when the failure means the series has no datapoints at all (absent, NO_DATA or NOT_COLLECTED). */
export function isMissingData(failure: MetricFailure): boolean {
  return failure.code === 'METRIC_MISSING' || failure.code === 'NO_DATA';
}

/**
 * Average per day for a Sum-statistic series: mean per-period sum scaled to 24 hours. Robust to partial
 * coverage because it averages only periods that have data.
 */
export function averagePerDay(read: { series: MetricSeriesSummary; stats: MetricStatistics }): number | null {
  if (read.stats.average === null) return null;
  return read.stats.average * (86_400 / read.series.periodSeconds);
}

/** Lowest coverage among several reads. */
export function minCoverageOf(...reads: { stats: MetricStatistics }[]): number {
  return Math.min(...reads.map((r) => r.stats.coverage));
}

export function observableDays(resource: NormalizedResource): number | null {
  return resource.utilization?.observableDays ?? null;
}

/**
 * Observation-period gate shared by metric-based rules: no utilization => METRICS_NOT_COLLECTED; fewer
 * observable days than required => INSUFFICIENT_OBSERVATION_PERIOD.
 */
export function requireObservation(
  resource: NormalizedResource,
  minObservationDays: number,
): { ok: true; observableDays: number } | { ok: false; reason: string } {
  const observable = observableDays(resource);
  if (observable === null) return { ok: false, reason: 'METRICS_NOT_COLLECTED' };
  if (observable < minObservationDays) {
    return {
      ok: false,
      reason: `INSUFFICIENT_OBSERVATION_PERIOD: ${round(observable, 1)} < ${minObservationDays} days`,
    };
  }
  return { ok: true, observableDays: observable };
}

/** Scales a total observed over `observedDays` to a 30-day month. */
export function normalizeTo30Days(total: number, observedDays: number): number {
  return observedDays > 0 ? (total * 30) / observedDays : 0;
}

/** Default confidence for metric-based detections: HIGH with >= 95% coverage over >= 28 days, else MEDIUM. */
export function coverageConfidence(coverage: number, observedDays: number): ConfidenceLevel {
  return coverage >= 0.95 && observedDays >= 28 ? 'HIGH' : 'MEDIUM';
}

export function observationEvidence(observedDays: number, minObservationDays: number): EvidenceItem {
  return {
    key: 'observation.days',
    label: 'Observation period',
    value: round(observedDays, 1),
    unit: 'days',
    threshold: `>= ${minObservationDays}`,
  };
}

export function coverageEvidence(coverage: number, minCoverage: number): EvidenceItem {
  return {
    key: 'metrics.coverage',
    label: 'Lowest metric coverage',
    value: round(coverage * 100, 1),
    unit: '%',
    threshold: `>= ${round(minCoverage * 100, 1)}`,
  };
}

export function ageInDays(createdAt: string | null, now: Date): number | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 86_400_000;
}

export function pct(value: number): number {
  return round(value, 2);
}

export const BYTES_PER_MB = 1_000_000;
export const BYTES_PER_GB = 1_000_000_000;
/** Binary gigabyte; AWS storage is billed per GB-month where GB = 2^30 bytes. */
export const BYTES_PER_GIB = 1024 ** 3;
