import type { EvidenceItem } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { normalizeTo30Days, readMetric } from './metric-helpers';
import type { ResourceOf } from './types';

/**
 * Lambda publishes metrics only for periods in which the function was invoked, so hourly coverage measures
 * invocation frequency rather than telemetry completeness. Lambda rules therefore do not gate on coverage by
 * default (tenants can raise `minCoverage`); a series with no datapoints at all is still NOT_EVALUATED.
 */
export const LAMBDA_COVERAGE_DESCRIPTION =
  'Minimum fraction (0-1) of expected hourly datapoints required. Default 0: Lambda publishes metrics only ' +
  'for hours with invocations, so missing hours mean no invocations rather than missing telemetry.';

export const LAMBDA_COMMON_DEFAULTS = { minObservationDays: 14, minCoverage: 0 };

/** Observed billed duration (Duration:Sum, milliseconds) normalised to 30 days, in seconds. */
export function monthlyDurationSeconds(
  resource: ResourceOf<'LAMBDA_FUNCTION'>,
  observedDays: number,
  minCoverage: number,
): { ok: true; seconds: number } | { ok: false; reason: string } {
  const read = readMetric(resource, 'Duration', 'Sum', minCoverage);
  if (!read.ok) return read;
  if (read.stats.sum === null) return { ok: false, reason: 'METRIC_STATISTICS_INCOMPLETE: Duration:Sum' };
  return { ok: true, seconds: normalizeTo30Days(read.stats.sum / 1000, observedDays) };
}

export function lambdaFunctionEvidence(resource: ResourceOf<'LAMBDA_FUNCTION'>): EvidenceItem[] {
  const a = resource.attributes;
  return [
    { key: 'function.runtime', label: 'Runtime', value: a.runtime ?? 'container image' },
    { key: 'function.architecture', label: 'Architecture', value: a.architecture },
    { key: 'function.memoryMb', label: 'Configured memory', value: a.memoryMb, unit: 'MB' },
    { key: 'function.timeoutSeconds', label: 'Timeout', value: a.timeoutSeconds, unit: 's' },
  ];
}

export function roundUpTo(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple;
}

export function gbSeconds(memoryMb: number, seconds: number): number {
  return round((memoryMb / 1024) * seconds, 2);
}
