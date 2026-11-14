import { round } from '@cloudsentry/utilities';
import {
  coverageConfidence,
  coverageEvidence,
  insufficientCoverageReason,
  observationEvidence,
  readMetric,
  requireObservation,
} from './metric-helpers';
import { redshiftClusterEvidence, redshiftStateGate } from './redshift-shared';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { minObservationDays: 14, minCoverage: 0.8 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const idleRedshiftClusterRule = defineRule({
  ruleId: 'idle-redshift-cluster',
  name: 'Idle Redshift cluster',
  description:
    'Available provisioned Redshift cluster with no database connections during the whole observation ' +
    'period. Nodes are billed per hour while the cluster runs; a paused cluster bills only storage.',
  resourceType: 'REDSHIFT_CLUSTER',
  category: 'IDLE',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage:
      'Minimum fraction (0-1) of expected hourly datapoints required to conclude there were no connections (any observed connection resolves the check regardless of coverage).',
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const gate = redshiftStateGate(resource);
    if (gate) return gate;
    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);

    const connections = readMetric(resource, 'DatabaseConnections', 'Maximum', 0);
    if (!connections.ok) return notEvaluated(connections.reason);
    const max = connections.stats.maximum;
    if (max === null) return notEvaluated('METRIC_STATISTICS_INCOMPLETE');
    if (max > 0) return NOT_DETECTED;
    const coverage = connections.stats.coverage;
    if (coverage < t.minCoverage) {
      return notEvaluated(insufficientCoverageReason('DatabaseConnections:Maximum', coverage, t.minCoverage));
    }

    const a = resource.attributes;
    const label = resource.name ?? a.clusterIdentifier;
    return {
      outcome: 'DETECTED',
      title: `Idle Redshift cluster ${label}`,
      description:
        `Cluster ${a.clusterIdentifier} (${a.numberOfNodes} x ${a.nodeType}) had no database connections in any hour ` +
        `over ${round(obs.observableDays, 0)} days, but its nodes are billed for every running hour.`,
      confidence: coverageConfidence(coverage, obs.observableDays),
      riskLevel: 'MEDIUM',
      evidence: [
        { key: 'connections.maximum', label: 'Maximum database connections', value: 0, threshold: '= 0' },
        observationEvidence(obs.observableDays, t.minObservationDays),
        coverageEvidence(coverage, t.minCoverage),
        ...redshiftClusterEvidence(resource),
      ],
      suggestedAction: {
        type: 'PAUSE_CLUSTER',
        summary: 'Confirm the cluster is unused, then pause it, or take a final snapshot and delete it.',
        steps: [
          'Check for consumers that do not open connections to this cluster, such as data sharing consumers, Redshift Spectrum or scheduled queries.',
          'Pause the cluster for short-term savings (it can be resumed later; compute billing stops while paused).',
          'If it remains unneeded, take a final manual snapshot and delete the cluster.',
        ],
      },
      savingsRequest: {
        kind: 'REDSHIFT_PAUSE',
        region: resource.region,
        nodeType: a.nodeType,
        numberOfNodes: a.numberOfNodes,
        pausableFraction: 1,
      },
    };
  },
});
