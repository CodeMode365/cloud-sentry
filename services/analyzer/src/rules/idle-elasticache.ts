import type { EvidenceItem, SavingsRequest } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { cacheClusterEvidence, cacheStateGate, isRedisCompatible } from './elasticache-shared';
import {
  BYTES_PER_GB,
  coverageConfidence,
  coverageEvidence,
  insufficientCoverageReason,
  observationEvidence,
  readMetric,
  requireObservation,
} from './metric-helpers';
import { elastiCachePriceListEngine } from './pricing-attributes';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { maxConnections: 0, minObservationDays: 14, minCoverage: 0.8 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const idleElastiCacheRule = defineRule({
  ruleId: 'idle-elasticache',
  name: 'Idle ElastiCache cluster',
  description:
    'Available ElastiCache cluster with no client connections for the whole observation period. Missing ' +
    'connection data is never treated as zero connections.',
  resourceType: 'ELASTICACHE_CLUSTER',
  category: 'IDLE',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    maxConnections: 'Maximum CurrConnections over the window must be at or below this value (connections).',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage:
      'Minimum fraction (0-1) of expected hourly datapoints required to conclude the cluster is idle (connections above the threshold resolve the check regardless of coverage).',
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const gate = cacheStateGate(resource);
    if (gate) return gate;
    const a = resource.attributes;
    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);

    const connections = readMetric(resource, 'CurrConnections', 'Maximum', 0);
    if (!connections.ok) return notEvaluated(connections.reason);
    const maxConnections = connections.stats.maximum;
    if (maxConnections === null) return notEvaluated('METRIC_STATISTICS_INCOMPLETE');
    // Any observed connection above the threshold proves activity, whatever the coverage.
    if (maxConnections > t.maxConnections) return NOT_DETECTED;
    const coverage = connections.stats.coverage;
    if (coverage < t.minCoverage) {
      return notEvaluated(insufficientCoverageReason('CurrConnections:Maximum', coverage, t.minCoverage));
    }

    const redisLike = isRedisCompatible(a.engine);
    const evidence: EvidenceItem[] = [
      {
        key: 'connections.maximum',
        label: 'Maximum client connections',
        value: round(maxConnections, 0),
        threshold: `<= ${t.maxConnections}`,
      },
    ];
    for (const metric of ['NetworkBytesIn', 'NetworkBytesOut'] as const) {
      const read = readMetric(resource, metric, 'Sum', 0);
      if (read.ok && read.stats.sum !== null) {
        evidence.push({
          key: `network.${metric === 'NetworkBytesIn' ? 'in' : 'out'}Gb`,
          label:
            metric === 'NetworkBytesIn'
              ? 'Network in (observation period)'
              : 'Network out (observation period)',
          value: round(read.stats.sum / BYTES_PER_GB, 3),
          unit: 'GB',
        });
      }
    }
    evidence.push(
      observationEvidence(obs.observableDays, t.minObservationDays),
      coverageEvidence(coverage, t.minCoverage),
      ...cacheClusterEvidence(resource),
    );

    let savingsRequest: SavingsRequest | null = null;
    const cacheEngine = elastiCachePriceListEngine(a.engine);
    if (cacheEngine) {
      savingsRequest = {
        kind: 'ELASTICACHE_DELETE',
        region: resource.region,
        cacheEngine,
        cacheNodeType: a.cacheNodeType,
        numNodes: a.numCacheNodes,
      };
    } else {
      evidence.push({
        key: 'pricing.unsupported',
        label: 'Pricing not available',
        value: `Engine "${a.engine}" is not supported by the savings engine`,
      });
    }

    const label = resource.name ?? a.cacheClusterId;
    return {
      outcome: 'DETECTED',
      title: `Idle ElastiCache cluster ${label}`,
      description:
        `Cache cluster ${a.cacheClusterId} (${a.numCacheNodes} x ${a.cacheNodeType}, ${a.engine}) had at most ` +
        `${round(maxConnections, 0)} client connections over ${round(obs.observableDays, 0)} days. Nodes are billed hourly whether or not they are used.`,
      confidence: coverageConfidence(coverage, obs.observableDays),
      riskLevel: 'HIGH',
      evidence,
      suggestedAction: {
        type: 'DELETE_CACHE_CLUSTER',
        summary: redisLike
          ? 'Confirm no application uses the cache, take a final snapshot, then delete it.'
          : 'Confirm no application uses the cache, then delete it (Memcached data is not persisted).',
        steps: [
          'Identify the owner from tags and check application configuration for this endpoint, including disaster-recovery or standby environments.',
          redisLike
            ? 'Create a manual snapshot (final backup) so the data can be restored if needed.'
            : 'Memcached clusters cannot be snapshotted; make sure the data can be rebuilt from its source.',
          a.replicationGroupId
            ? `This cluster belongs to replication group ${a.replicationGroupId}; delete or resize the replication group rather than a single member.`
            : 'Delete the cluster.',
        ],
      },
      savingsRequest,
    };
  },
});
