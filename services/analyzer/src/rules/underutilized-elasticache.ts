import type { ConfidenceLevel, EvidenceItem, SavingsRequest } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { cacheClusterEvidence, cacheStateGate, isRedisCompatible } from './elasticache-shared';
import {
  coverageConfidence,
  coverageEvidence,
  minCoverageOf,
  observationEvidence,
  pct,
  readMetric,
  readMetrics,
  requireObservation,
} from './metric-helpers';
import { elastiCachePriceListEngine, nextSmallerCacheNodeType } from './pricing-attributes';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = {
  maxCpuPercent: 10,
  maxCpuPeakPercent: 40,
  maxMemoryPercent: 30,
  minObservationDays: 14,
  minCoverage: 0.8,
};
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const underutilizedElastiCacheRule = defineRule({
  ruleId: 'underutilized-elasticache',
  name: 'Underutilized ElastiCache cluster',
  description:
    'Available ElastiCache cluster with low CPU (engine CPU for Redis/Valkey when available) on average and at ' +
    'peak, and low memory use (Redis/Valkey). Memcached has no comparable memory metric, so its memory is not ' +
    'checked and confidence is LOW.',
  resourceType: 'ELASTICACHE_CLUSTER',
  category: 'OVERPROVISIONED',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    maxCpuPercent: 'Average CPU (EngineCPUUtilization or CPUUtilization) must be below this value (percent).',
    maxCpuPeakPercent: 'Maximum hourly CPU must be below this value (percent).',
    maxMemoryPercent:
      'Maximum DatabaseMemoryUsagePercentage must be below this value (percent; Redis/Valkey only).',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage: 'Minimum fraction (0-1) of expected hourly datapoints that must be present for each metric.',
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const gate = cacheStateGate(resource);
    if (gate) return gate;
    const a = resource.attributes;
    const redisLike = isRedisCompatible(a.engine);

    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);

    const cpuSpecs = (metric: string) =>
      readMetrics(resource, { avg: [metric, 'Average'], max: [metric, 'Maximum'] }, t.minCoverage);
    let cpuMetric = 'CPUUtilization';
    let cpu = cpuSpecs(cpuMetric);
    if (redisLike) {
      const engineCpu = cpuSpecs('EngineCPUUtilization');
      if (engineCpu.ok) {
        cpuMetric = 'EngineCPUUtilization';
        cpu = engineCpu;
      }
    }
    if (!cpu.ok) return notEvaluated(cpu.reason);
    const cpuAverage = cpu.values.avg.stats.average;
    const cpuMaximum = cpu.values.max.stats.maximum;
    if (cpuAverage === null || cpuMaximum === null) return notEvaluated('METRIC_STATISTICS_INCOMPLETE');

    let memoryMax: number | null = null;
    let coverage = minCoverageOf(cpu.values.avg, cpu.values.max);
    if (redisLike) {
      const memory = readMetric(resource, 'DatabaseMemoryUsagePercentage', 'Maximum', t.minCoverage);
      if (!memory.ok) return notEvaluated(memory.reason);
      memoryMax = memory.stats.maximum;
      if (memoryMax === null) return notEvaluated('METRIC_STATISTICS_INCOMPLETE');
      coverage = Math.min(coverage, memory.stats.coverage);
    }

    const low =
      cpuAverage < t.maxCpuPercent &&
      cpuMaximum < t.maxCpuPeakPercent &&
      (memoryMax === null || memoryMax < t.maxMemoryPercent);
    if (!low) return NOT_DETECTED;

    const target = nextSmallerCacheNodeType(a.cacheNodeType);
    const confidence: ConfidenceLevel = redisLike ? coverageConfidence(coverage, obs.observableDays) : 'LOW';
    const evidence: EvidenceItem[] = [
      { key: 'cpu.metric', label: 'CPU metric used', value: cpuMetric },
      {
        key: 'cpu.average',
        label: 'Average CPU utilization',
        value: pct(cpuAverage),
        unit: '%',
        threshold: `< ${t.maxCpuPercent}`,
      },
      {
        key: 'cpu.maximum',
        label: 'Maximum hourly CPU utilization',
        value: pct(cpuMaximum),
        unit: '%',
        threshold: `< ${t.maxCpuPeakPercent}`,
      },
      memoryMax === null
        ? {
            key: 'memory.note',
            label: 'Memory',
            value: 'Not checked: Memcached does not publish DatabaseMemoryUsagePercentage',
          }
        : {
            key: 'memory.maximum',
            label: 'Maximum memory usage',
            value: pct(memoryMax),
            unit: '%',
            threshold: `< ${t.maxMemoryPercent}`,
          },
      { key: 'cache.targetNodeType', label: 'Suggested node type', value: target ?? 'none in this family' },
      observationEvidence(obs.observableDays, t.minObservationDays),
      coverageEvidence(coverage, t.minCoverage),
      ...cacheClusterEvidence(resource),
    ];

    let savingsRequest: SavingsRequest | null = null;
    const cacheEngine = elastiCachePriceListEngine(a.engine);
    if (cacheEngine) {
      savingsRequest = {
        kind: 'ELASTICACHE_RIGHTSIZE',
        region: resource.region,
        cacheEngine,
        currentNodeType: a.cacheNodeType,
        targetNodeType: target,
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
      title: `Underutilized ElastiCache cluster ${label}`,
      description:
        `Cache cluster ${a.cacheClusterId} (${a.cacheNodeType}, ${a.engine}) averaged ${pct(cpuAverage)}% CPU ` +
        `(peak ${pct(cpuMaximum)}%)` +
        (memoryMax === null ? '' : ` with at most ${pct(memoryMax)}% memory used`) +
        ` over ${round(obs.observableDays, 0)} days.` +
        (target ? ` A ${target} node may be sufficient.` : ' No smaller node type in this family was identified.'),
      confidence,
      riskLevel: 'MEDIUM',
      evidence,
      suggestedAction: {
        type: 'RIGHTSIZE_CACHE_NODE',
        summary: target
          ? `Consider scaling down from ${a.cacheNodeType} to ${target} after validating memory and network headroom.`
          : `Utilization is low, but no smaller node type in the ${a.cacheNodeType} family was identified; review the node family.`,
        steps: [
          'Check evictions, memory fragmentation, network throughput and connection peaks (including month-end or batch traffic).',
          'Confirm the smaller node type has enough memory for the dataset plus overhead, and enough network bandwidth.',
          'Scale the node type through your infrastructure-as-code during a maintenance window; for replication groups the change applies to all nodes.',
          'Monitor CPU, memory, evictions and latency after the change.',
        ],
      },
      savingsRequest,
    };
  },
});
