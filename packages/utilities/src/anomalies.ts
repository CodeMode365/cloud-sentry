import type { DailyCostPoint } from '@cloudsentry/shared-types';
import { mean, round } from './stats';

export interface DailyAnomaly {
  date: string;
  amount: number;
  baseline: number;
  deviationPercent: number;
}

export interface AnomalyOptions {
  /** Trailing window length (days) used as the baseline; also the minimum history before detection starts. */
  minHistory?: number;
  /** Standard deviations above the trailing mean that count as an anomaly. */
  zThreshold?: number;
  /** Ignore spikes smaller than this absolute amount (filters cent-level noise). */
  minAbsoluteDeviation?: number;
}

/**
 * Deterministic spike detection over actual daily costs: a day is anomalous when it exceeds the trailing
 * window mean by `zThreshold` standard deviations AND by `minAbsoluteDeviation`. When the window has zero
 * variance, the spike must exceed the mean by 50% (and the absolute minimum). Windows whose mean is zero
 * are skipped (percentage deviation is undefined). Only upward spikes are reported.
 */
export function detectDailyAnomalies(
  daily: readonly DailyCostPoint[],
  options: AnomalyOptions = {},
): DailyAnomaly[] {
  const window = options.minHistory ?? 14;
  const z = options.zThreshold ?? 3;
  const minAbs = options.minAbsoluteDeviation ?? 1;
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const anomalies: DailyAnomaly[] = [];

  for (let i = window; i < sorted.length; i++) {
    const point = sorted[i] as DailyCostPoint;
    const history = sorted.slice(i - window, i).map((p) => p.amount);
    const baseline = mean(history) ?? 0;
    if (baseline <= 0) continue;
    const variance = history.reduce((s, v) => s + (v - baseline) ** 2, 0) / history.length;
    const stddev = Math.sqrt(variance);
    const deviation = point.amount - baseline;
    if (deviation < minAbs) continue;
    const isAnomaly = stddev === 0 ? deviation > baseline * 0.5 : deviation / stddev >= z;
    if (!isAnomaly) continue;
    anomalies.push({
      date: point.date,
      amount: point.amount,
      baseline: round(baseline, 2),
      deviationPercent: round((deviation / baseline) * 100, 1),
    });
  }
  return anomalies;
}
