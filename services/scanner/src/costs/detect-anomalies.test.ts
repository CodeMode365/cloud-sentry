import { describe, expect, it } from 'vitest';
import type { DailyCostPoint } from '@cloudsentry/shared-types';
import { detectDailyAnomalies } from './detect-anomalies';

function series(amounts: number[]): DailyCostPoint[] {
  return amounts.map((amount, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    amount,
    unfinalized: false,
  }));
}

describe('detectDailyAnomalies', () => {
  it('flags spikes beyond the z-score threshold', () => {
    const base = [10, 11, 9, 10, 10, 11, 9, 10, 10, 11, 9, 10, 10, 11];
    const result = detectDailyAnomalies(series([...base, 50, 10.5]));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ date: '2026-10-15', amount: 50, baseline: 10.07 });
    expect(result[0]?.deviationPercent).toBeCloseTo(396.5, 0);
  });

  it('handles zero-variance windows and ignores small or downward deviations', () => {
    const flat = Array.from({ length: 14 }, () => 10);
    expect(detectDailyAnomalies(series([...flat, 20]))).toHaveLength(1);
    expect(detectDailyAnomalies(series([...flat, 10.6]))).toHaveLength(0);
    expect(detectDailyAnomalies(series([...flat, 0]))).toHaveLength(0);
  });

  it('requires enough history and skips zero baselines', () => {
    expect(detectDailyAnomalies(series([1, 1, 100]))).toEqual([]);
    expect(detectDailyAnomalies(series([...Array.from({ length: 14 }, () => 0), 100]))).toEqual([]);
  });
});
