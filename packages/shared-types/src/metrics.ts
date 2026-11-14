/**
 * Utilization data collected from CloudWatch. Unavailable data is always represented explicitly
 * (availability !== 'AVAILABLE' and stats === null) and is never coerced to zero.
 */

export const METRIC_AVAILABILITY = ['AVAILABLE', 'NO_DATA', 'NOT_COLLECTED', 'ERROR'] as const;
export type MetricAvailability = (typeof METRIC_AVAILABILITY)[number];

export type MetricStatisticName = 'Average' | 'Maximum' | 'Minimum' | 'Sum';

export interface MetricStatistics {
  /** Mean of the per-period datapoints. */
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  /** Percentiles computed over the per-period datapoints (not raw samples). */
  p50: number | null;
  p95: number | null;
  p99: number | null;
  /** Sum of all per-period datapoints (meaningful for Sum statistics). */
  sum: number | null;
  datapoints: number;
  expectedDatapoints: number;
  /** datapoints / expectedDatapoints, 0..1. */
  coverage: number;
  /**
   * Fraction (0..1) of returned datapoints whose value is exactly 0, e.g. the share of hours with no
   * connections. null when there are no datapoints.
   */
  zeroFraction: number | null;
}

export interface MetricSeriesSummary {
  namespace: string;
  metricName: string;
  statistic: MetricStatisticName;
  periodSeconds: number;
  unit: string | null;
  availability: MetricAvailability;
  stats: MetricStatistics | null;
  error?: string;
}

export interface ResourceUtilization {
  lookbackDays: number;
  periodStart: string;
  periodEnd: string;
  collectedAt: string;
  /** Days of history the resource could have had (bounded by creation time and lookback). */
  observableDays: number;
  /** Keyed by `${metricName}:${statistic}`, e.g. "CPUUtilization:Average". */
  metrics: Record<string, MetricSeriesSummary>;
}

export function metricKey(metricName: string, statistic: MetricStatisticName): string {
  return `${metricName}:${statistic}`;
}
