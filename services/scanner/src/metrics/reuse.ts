import type { DiscoveredResource, ResourceUtilization } from '@cloudsentry/shared-types';
import { MS_PER_HOUR, resourceKeyFor } from '@cloudsentry/utilities';
import { metricQueriesFor } from './catalog';

export interface ReuseOptions {
  reuseHours: number;
  lookbackDays: number;
  now: Date;
}

export interface ReusePartition {
  /** Previously collected utilization that is still fresh, keyed by resourceKey. */
  reuse: Map<string, ResourceUtilization>;
  /** Qualifying resources that must be (re)collected. Non-qualifying resources appear in neither set. */
  collect: DiscoveredResource[];
}

/**
 * Avoids redundant CloudWatch requests: utilization collected within `reuseHours` for the same lookback
 * window, without errors, is reused instead of being queried again. It must also hold every key the
 * catalog currently plans for the resource, so new queries (e.g. a new Lambda provisioned concurrency
 * qualifier) are collected instead of silently missing.
 */
export function partitionForReuse(
  resources: readonly DiscoveredResource[],
  previous: ReadonlyMap<string, ResourceUtilization | null>,
  opts: ReuseOptions,
): ReusePartition {
  const reuse = new Map<string, ResourceUtilization>();
  const collect: DiscoveredResource[] = [];
  for (const resource of resources) {
    const queries = metricQueriesFor(resource);
    if (queries.length === 0) continue;
    const key = resourceKeyFor(
      resource.accountId,
      resource.region,
      resource.resourceType,
      resource.resourceId,
    );
    const prev = previous.get(key);
    if (prev && isReusable(prev, opts) && queries.every((q) => q.key in prev.metrics)) reuse.set(key, prev);
    else collect.push(resource);
  }
  return { reuse, collect };
}

function isReusable(prev: ResourceUtilization, opts: ReuseOptions): boolean {
  if (opts.reuseHours <= 0) return false;
  if (prev.lookbackDays !== opts.lookbackDays) return false;
  const collectedAt = new Date(prev.collectedAt).getTime();
  if (Number.isNaN(collectedAt)) return false;
  const ageMs = opts.now.getTime() - collectedAt;
  if (ageMs < 0 || ageMs > opts.reuseHours * MS_PER_HOUR) return false;
  return !Object.values(prev.metrics).some(
    (m) => m.availability === 'ERROR' || m.availability === 'NOT_COLLECTED',
  );
}
