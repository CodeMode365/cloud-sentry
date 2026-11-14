import type { ConfidenceLevel } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { averagePerDay, BYTES_PER_GB, minCoverageOf, readMetrics } from './metric-helpers';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { maxGbPerDay: 1, maxActiveConnections: 10, minObservationDays: 14, minCoverage: 0.8 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const idleNatGatewayRule = defineRule({
  ruleId: 'idle-nat-gateway',
  name: 'Idle NAT Gateway',
  description:
    'Available NAT Gateway with consistently low processed traffic and few active connections. Low traffic ' +
    'does not prove the gateway can be removed; it may serve infrequent but critical egress.',
  resourceType: 'NAT_GATEWAY',
  category: 'IDLE',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    maxGbPerDay:
      'Average BytesOutToDestination + BytesInFromDestination per day must be below this value (GB, 10^9 bytes).',
    maxActiveConnections: 'Maximum ActiveConnectionCount must be below this value.',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage: 'Minimum fraction (0-1) of expected hourly datapoints that must be present for each metric.',
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    if (resource.state === 'deleted' || resource.state === 'deleting') return NOT_DETECTED;
    if (resource.state !== 'available') return notEvaluated(`TRANSIENT_STATE: ${resource.state}`);
    const observable = resource.utilization?.observableDays ?? null;
    if (observable === null) return notEvaluated('METRICS_NOT_COLLECTED');
    if (observable < t.minObservationDays) {
      return notEvaluated(
        `INSUFFICIENT_OBSERVATION_PERIOD: ${round(observable, 1)} < ${t.minObservationDays} days`,
      );
    }
    const reads = readMetrics(
      resource,
      {
        out: ['BytesOutToDestination', 'Sum'],
        inbound: ['BytesInFromDestination', 'Sum'],
        conn: ['ActiveConnectionCount', 'Maximum'],
      },
      t.minCoverage,
    );
    if (!reads.ok) return notEvaluated(reads.reason);
    const outPerDay = averagePerDay(reads.values.out);
    const inPerDay = averagePerDay(reads.values.inbound);
    const maxConn = reads.values.conn.stats.maximum;
    if (outPerDay === null || inPerDay === null || maxConn === null)
      return notEvaluated('METRIC_STATISTICS_INCOMPLETE');
    const gbPerDay = (outPerDay + inPerDay) / BYTES_PER_GB;
    if (!(gbPerDay < t.maxGbPerDay && maxConn < t.maxActiveConnections)) return NOT_DETECTED;

    const coverage = minCoverageOf(reads.values.out, reads.values.inbound, reads.values.conn);
    const confidence: ConfidenceLevel = coverage >= 0.95 && observable >= 28 ? 'MEDIUM' : 'LOW';
    const a = resource.attributes;
    const label = resource.name ?? resource.resourceId;
    return {
      outcome: 'DETECTED',
      title: `Low-traffic NAT Gateway ${label}`,
      description:
        `NAT Gateway ${resource.resourceId}${a.vpcId ? ` in ${a.vpcId}` : ''} processed about ${round(gbPerDay, 3)} GB/day ` +
        `with at most ${round(maxConn, 0)} active connections over ${round(observable, 0)} days. NAT Gateways are billed hourly regardless of traffic.`,
      confidence,
      riskLevel: 'HIGH',
      evidence: [
        {
          key: 'traffic.gbPerDay',
          label: 'Average traffic per day',
          value: round(gbPerDay, 4),
          unit: 'GB',
          threshold: `< ${t.maxGbPerDay}`,
        },
        {
          key: 'connections.maximum',
          label: 'Maximum active connections',
          value: round(maxConn, 0),
          threshold: `< ${t.maxActiveConnections}`,
        },
        {
          key: 'observation.days',
          label: 'Observation period',
          value: round(observable, 1),
          unit: 'days',
          threshold: `>= ${t.minObservationDays}`,
        },
        {
          key: 'metrics.coverage',
          label: 'Lowest metric coverage',
          value: round(coverage * 100, 1),
          unit: '%',
          threshold: `>= ${t.minCoverage * 100}`,
        },
        { key: 'nat.vpcId', label: 'VPC', value: a.vpcId },
        { key: 'nat.subnetId', label: 'Subnet', value: a.subnetId },
        { key: 'nat.connectivityType', label: 'Connectivity type', value: a.connectivityType },
      ],
      suggestedAction: {
        type: 'REVIEW_NAT_GATEWAY',
        summary:
          'Review whether private subnets in this VPC still need internet egress through this gateway.',
        steps: [
          'Identify route tables that target this NAT Gateway and the workloads in those subnets.',
          'Check for infrequent but critical egress (patching, license checks, scheduled jobs) not visible in the observation window.',
          'Consider VPC endpoints for AWS service traffic, or consolidating NAT Gateways across Availability Zones if resilience requirements allow.',
          'Only delete the gateway after updating route tables; removing it breaks outbound connectivity for dependent subnets.',
        ],
      },
      savingsRequest: { kind: 'NAT_GATEWAY_DELETE', region: resource.region },
    };
  },
});
