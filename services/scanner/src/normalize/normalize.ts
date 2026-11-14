import type {
  DiscoveredResource,
  NormalizedResource,
  ResourceType,
  ResourceUtilization,
} from '@cloudsentry/shared-types';
import { resourceKeyFor } from '@cloudsentry/utilities';

export interface NormalizeOptions {
  /** Regions in which discovery fully succeeded, per resource type. */
  succeededRegionsByType: Partial<Record<ResourceType, string[]>>;
}

/**
 * Merges discovery output with utilization into the detection engine's input. Deduplicates by
 * resourceKey (first occurrence wins) and sorts by resourceKey for deterministic output.
 */
export function normalizeResources(
  discovered: readonly DiscoveredResource[],
  utilization: ReadonlyMap<string, ResourceUtilization>,
  options: NormalizeOptions,
): NormalizedResource[] {
  const ebsRegions = new Set(options.succeededRegionsByType.EBS_VOLUME ?? []);
  const volumesByRegion = new Map<string, Set<string>>();
  for (const r of discovered) {
    if (r.resourceType !== 'EBS_VOLUME') continue;
    const set = volumesByRegion.get(r.region) ?? new Set<string>();
    set.add(r.resourceId);
    volumesByRegion.set(r.region, set);
  }

  const byKey = new Map<string, NormalizedResource>();
  for (const resource of discovered) {
    const resourceKey = resourceKeyFor(
      resource.accountId,
      resource.region,
      resource.resourceType,
      resource.resourceId,
    );
    if (byKey.has(resourceKey)) continue;
    let normalized: NormalizedResource;
    if (resource.resourceType === 'EBS_SNAPSHOT') {
      // Only claim the source volume is gone when EBS discovery for that region succeeded.
      const sourceVolumeExists = ebsRegions.has(resource.region)
        ? resource.attributes.volumeId !== null &&
          (volumesByRegion.get(resource.region)?.has(resource.attributes.volumeId) ?? false)
        : null;
      normalized = {
        ...resource,
        attributes: { ...resource.attributes, sourceVolumeExists },
        resourceKey,
        utilization: utilization.get(resourceKey) ?? null,
      };
    } else {
      normalized = { ...resource, resourceKey, utilization: utilization.get(resourceKey) ?? null };
    }
    byKey.set(resourceKey, normalized);
  }

  return [...byKey.values()].sort((a, b) =>
    a.resourceKey < b.resourceKey ? -1 : a.resourceKey > b.resourceKey ? 1 : 0,
  );
}
