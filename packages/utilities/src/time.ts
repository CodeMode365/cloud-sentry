export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function daysBetween(from: Date | string, to: Date | string): number {
  const a = typeof from === 'string' ? new Date(from) : from;
  const b = typeof to === 'string' ? new Date(to) : to;
  return (b.getTime() - a.getTime()) / MS_PER_DAY;
}

/** YYYY-MM-DD in UTC. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** First day of the UTC month containing `date`. */
export function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

export function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
