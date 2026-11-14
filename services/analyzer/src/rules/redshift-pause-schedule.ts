import { round } from '@cloudsentry/utilities';
import { coverageEvidence, observationEvidence, readMetric, requireObservation } from './metric-helpers';
import { redshiftClusterEvidence, redshiftStateGate } from './redshift-shared';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { minIdleFraction: 0.4, minObservationDays: 14, minCoverage: 0.8 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const redshiftPauseScheduleRule = defineRule({
  ruleId: 'redshift-pause-schedule',
  name: 'Redshift cluster suited to a pause/resume schedule',
  description:
    'Available Redshift cluster that has no database connections for a large share of hours but is not idle ' +
    'all the time (fully idle clusters are reported by idle-redshift-cluster). A pause/resume schedule can ' +
    'stop compute billing during regular idle windows.',
  resourceType: 'REDSHIFT_CLUSTER',
  category: 'IDLE',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    minIdleFraction:
      'Share (0-1) of hours whose DatabaseConnections:Maximum is 0 must be at least this value.',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage: 'Minimum fraction (0-1) of expected hourly datapoints that must be present.',
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const gate = redshiftStateGate(resource);
    if (gate) return gate;
    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);

    const connections = readMetric(resource, 'DatabaseConnections', 'Maximum', t.minCoverage);
    if (!connections.ok) return notEvaluated(connections.reason);
    const { maximum, zeroFraction, datapoints, coverage } = connections.stats;
    if (maximum === null) return notEvaluated('METRIC_STATISTICS_INCOMPLETE');
    if (maximum === 0) return NOT_DETECTED; // fully idle: idle-redshift-cluster applies
    if (zeroFraction === null) return notEvaluated('METRIC_STATISTICS_INCOMPLETE: zeroFraction');
    if (zeroFraction < t.minIdleFraction) return NOT_DETECTED;

    const a = resource.attributes;
    const pausableFraction = round(zeroFraction, 4);
    const label = resource.name ?? a.clusterIdentifier;
    return {
      outcome: 'DETECTED',
      title: `Redshift cluster ${label} is idle ${round(zeroFraction * 100, 0)}% of the time`,
      description:
        `Cluster ${a.clusterIdentifier} (${a.numberOfNodes} x ${a.nodeType}) had no database connections in ` +
        `${round(zeroFraction * 100, 1)}% of the hours observed over ${round(obs.observableDays, 0)} days. If those ` +
        'hours fall into regular windows (nights, weekends), pausing the cluster on a schedule stops compute billing for them.',
      confidence: 'MEDIUM',
      riskLevel: 'MEDIUM',
      evidence: [
        {
          key: 'connections.zeroFraction',
          label: 'Hours with no database connections',
          value: round(zeroFraction * 100, 1),
          unit: '%',
          threshold: `>= ${round(t.minIdleFraction * 100, 1)}`,
        },
        {
          key: 'connections.idleHours',
          label: 'Idle hours observed',
          value: Math.round(zeroFraction * datapoints),
          unit: `of ${datapoints} hours`,
        },
        {
          key: 'connections.maximum',
          label: 'Maximum database connections',
          value: round(maximum, 0),
          threshold: '> 0',
        },
        observationEvidence(obs.observableDays, t.minObservationDays),
        coverageEvidence(coverage, t.minCoverage),
        {
          key: 'pattern.note',
          label: 'Idle pattern',
          value:
            'Idle hours are counted, not located: scattered idle hours cannot all be paused, so the estimate is an upper bound.',
        },
        ...redshiftClusterEvidence(resource),
      ],
      suggestedAction: {
        type: 'SCHEDULE_PAUSE_RESUME',
        summary:
          'Review when the cluster is idle and, if the idle hours are regular, create a pause/resume schedule.',
        steps: [
          'Plot DatabaseConnections by hour of day and day of week to find regular idle windows.',
          'Check scheduled loads, ETL jobs, data sharing consumers and dashboards that must find the cluster running.',
          'Create a pause and resume schedule (Redshift scheduled actions) with a margin around the idle window; resuming takes several minutes.',
          'Review query failures and job timings after the first scheduled cycles.',
        ],
      },
      savingsRequest: {
        kind: 'REDSHIFT_PAUSE',
        region: resource.region,
        nodeType: a.nodeType,
        numberOfNodes: a.numberOfNodes,
        pausableFraction,
      },
    };
  },
});
