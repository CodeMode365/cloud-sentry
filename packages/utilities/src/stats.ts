/** Linear-interpolated percentile (p in 0..100) of a numeric array. Returns null for empty input. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0] as number;
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const lo = sorted[lower] as number;
  const hi = sorted[upper] as number;
  return lo + (hi - lo) * (rank - lower);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function sum(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

export function minOf(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.min(...values);
}

export function maxOf(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

/** Rounds a currency amount to cents. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
