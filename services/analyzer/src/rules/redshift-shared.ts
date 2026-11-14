import type { EvidenceItem } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { readMetric } from './metric-helpers';
import {
  NOT_DETECTED,
  notEvaluated,
  type NotDetectedOutcome,
  type NotEvaluatedOutcome,
  type ResourceOf,
} from './types';

export type RedshiftCluster = ResourceOf<'REDSHIFT_CLUSTER'>;

/** `available` clusters are evaluated; paused/deleting are NOT_DETECTED; other states are transient. */
export function redshiftStateGate(
  resource: RedshiftCluster,
): NotDetectedOutcome | NotEvaluatedOutcome | null {
  const status = resource.attributes.clusterStatus || resource.state;
  if (status === 'available') return null;
  if (status === 'paused' || status === 'deleting' || status === 'pausing') return NOT_DETECTED;
  return notEvaluated(`TRANSIENT_STATE: ${status}`);
}

export function redshiftClusterEvidence(resource: RedshiftCluster): EvidenceItem[] {
  const a = resource.attributes;
  const evidence: EvidenceItem[] = [
    { key: 'cluster.nodeType', label: 'Node type', value: a.nodeType },
    { key: 'cluster.nodes', label: 'Nodes', value: a.numberOfNodes },
    { key: 'cluster.multiAz', label: 'Multi-AZ', value: a.multiAz === null ? 'unknown' : a.multiAz },
  ];
  const cpu = readMetric(resource, 'CPUUtilization', 'Average', 0);
  if (cpu.ok && cpu.stats.average !== null) {
    evidence.push({
      key: 'cpu.average',
      label: 'Average CPU utilization',
      value: round(cpu.stats.average, 2),
      unit: '%',
    });
  }
  const disk = readMetric(resource, 'PercentageDiskSpaceUsed', 'Average', 0);
  if (disk.ok && disk.stats.average !== null) {
    evidence.push({
      key: 'disk.usedAverage',
      label: 'Average disk space used',
      value: round(disk.stats.average, 2),
      unit: '%',
    });
  }
  if (a.nodeType.toLowerCase().startsWith('ra3')) {
    evidence.push({
      key: 'pricing.managedStorage',
      label: 'Managed storage',
      value:
        'RA3 managed storage is still billed while the cluster is paused and is not included in the estimate.',
    });
  }
  return evidence;
}
