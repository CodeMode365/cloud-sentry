import type { EksNodegroupSummary, EvidenceItem } from '@cloudsentry/shared-types';
import { isMissingData, type MetricFailure } from './metric-helpers';
import {
  NOT_DETECTED,
  notEvaluated,
  type NotDetectedOutcome,
  type NotEvaluatedOutcome,
  type ResourceOf,
} from './types';

export type EksCluster = ResourceOf<'EKS_CLUSTER'>;

/**
 * ACTIVE clusters are evaluated; DELETING is NOT_DETECTED; other states are transient. Discovery placeholders
 * (state "unknown" when DescribeCluster failed, node group status null with zero sizes when DescribeNodegroup
 * failed) are NOT_EVALUATED: their zeros are not real.
 */
export function eksStateGate(resource: EksCluster): NotDetectedOutcome | NotEvaluatedOutcome | null {
  if (resource.state === 'unknown') {
    return notEvaluated('CLUSTER_DETAILS_UNAVAILABLE: cluster details could not be read during discovery');
  }
  const unavailable = resource.attributes.nodegroups.filter((ng) => ng.status === null).map((ng) => ng.name);
  if (unavailable.length > 0) {
    return notEvaluated(`NODEGROUP_DETAILS_UNAVAILABLE: ${unavailable.join(', ')}`);
  }
  if (resource.state === 'ACTIVE') return null;
  if (resource.state === 'DELETING') return NOT_DETECTED;
  return notEvaluated(`TRANSIENT_STATE: ${resource.state}`);
}

export function totalDesiredNodes(nodegroups: readonly EksNodegroupSummary[]): number {
  return nodegroups.reduce((s, ng) => s + Math.max(0, ng.desiredSize), 0);
}

/** Container Insights metrics are NO_DATA unless the add-on/agent is installed: say so explicitly. */
export function containerInsightsReason(failure: MetricFailure): string {
  return isMissingData(failure)
    ? `CONTAINER_INSIGHTS_NOT_ENABLED: ${failure.reason} (enable CloudWatch Container Insights to evaluate)`
    : failure.reason;
}

/** The node group with the most desired nodes (ties broken by name for determinism). */
export function largestNodegroup(nodegroups: readonly EksNodegroupSummary[]): EksNodegroupSummary | null {
  const sorted = [...nodegroups].sort(
    (x, y) => y.desiredSize - x.desiredSize || x.name.localeCompare(y.name),
  );
  return sorted[0] ?? null;
}

export function eksClusterEvidence(resource: EksCluster): EvidenceItem[] {
  const a = resource.attributes;
  return [
    { key: 'cluster.version', label: 'Kubernetes version', value: a.version },
    { key: 'cluster.nodegroups', label: 'Managed node groups', value: a.nodegroups.length },
    { key: 'cluster.fargateProfiles', label: 'Fargate profiles', value: a.fargateProfileCount },
    { key: 'cluster.autoMode', label: 'EKS Auto Mode', value: a.autoModeEnabled },
  ];
}
