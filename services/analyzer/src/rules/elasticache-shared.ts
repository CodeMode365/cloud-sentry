import type { EvidenceItem } from '@cloudsentry/shared-types';
import { NOT_DETECTED, notEvaluated, type NotDetectedOutcome, type NotEvaluatedOutcome, type ResourceOf } from './types';

export type CacheCluster = ResourceOf<'ELASTICACHE_CLUSTER'>;

/** `available` clusters are evaluated; deleting/deleted are NOT_DETECTED; other states are transient. */
export function cacheStateGate(resource: CacheCluster): NotDetectedOutcome | NotEvaluatedOutcome | null {
  if (resource.state === 'available') return null;
  if (resource.state === 'deleting' || resource.state === 'deleted') return NOT_DETECTED;
  return notEvaluated(`TRANSIENT_STATE: ${resource.state}`);
}

export function isRedisCompatible(engine: string): boolean {
  const e = engine.toLowerCase();
  return e === 'redis' || e === 'valkey';
}

export function cacheClusterEvidence(resource: CacheCluster): EvidenceItem[] {
  const a = resource.attributes;
  const evidence: EvidenceItem[] = [
    { key: 'cache.engine', label: 'Engine', value: a.engineVersion ? `${a.engine} ${a.engineVersion}` : a.engine },
    { key: 'cache.nodeType', label: 'Node type', value: a.cacheNodeType },
    { key: 'cache.numNodes', label: 'Nodes', value: a.numCacheNodes },
  ];
  if (a.replicationGroupId) {
    evidence.push({
      key: 'cache.replicationGroup',
      label: 'Replication group',
      value: `${a.replicationGroupId}: changes apply to the whole replication group, not this node alone`,
    });
  }
  return evidence;
}
