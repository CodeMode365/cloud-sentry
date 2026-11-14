import type { EvidenceItem } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { containerInsightsReason, eksClusterEvidence, eksStateGate } from './eks-shared';
import {
  coverageEvidence,
  minCoverageOf,
  observationEvidence,
  pct,
  readMetrics,
  requireObservation,
} from './metric-helpers';
import { defineRule, notEvaluated, NOT_DETECTED } from './types';

const DEFAULTS = { minReservedPercent: 70, maxUsedPercent: 25, minObservationDays: 14, minCoverage: 0.8 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

type SideResult =
  | { status: 'DETECTED' | 'CLEAR'; reserved: number; used: number; coverage: number }
  | { status: 'FAILED'; reason: string };

const SIDES = [
  { side: 'cpu', label: 'CPU', reserved: 'node_cpu_reserved_capacity', used: 'node_cpu_utilization' },
  {
    side: 'memory',
    label: 'memory',
    reserved: 'node_memory_reserved_capacity',
    used: 'node_memory_utilization',
  },
] as const;

export const eksOversizedRequestsRule = defineRule({
  ruleId: 'eks-oversized-requests',
  name: 'Oversized EKS pod requests',
  description:
    'EKS cluster whose pods reserve most node capacity through requests while actual usage stays low, for ' +
    'CPU or memory. Oversized requests keep nodes "full" and force extra nodes. Requires CloudWatch ' +
    'Container Insights. Savings depend on workload changes and are not estimated.',
  resourceType: 'EKS_CLUSTER',
  category: 'OVERPROVISIONED',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    minReservedPercent:
      'Average node_cpu_reserved_capacity (or node_memory_reserved_capacity) must be at least this value (percent).',
    maxUsedPercent:
      'Average node_cpu_utilization (or node_memory_utilization) must be at most this value (percent).',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage: 'Minimum fraction (0-1) of expected hourly datapoints that must be present for each metric.',
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const gate = eksStateGate(resource);
    if (gate) return gate;
    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);

    const results = SIDES.map((s): SideResult & { side: string; label: string } => {
      const reads = readMetrics(
        resource,
        { reserved: [s.reserved, 'Average'], used: [s.used, 'Average'] },
        t.minCoverage,
      );
      if (!reads.ok)
        return { side: s.side, label: s.label, status: 'FAILED', reason: containerInsightsReason(reads) };
      const reserved = reads.values.reserved.stats.average;
      const used = reads.values.used.stats.average;
      if (reserved === null || used === null) {
        return { side: s.side, label: s.label, status: 'FAILED', reason: 'METRIC_STATISTICS_INCOMPLETE' };
      }
      const coverage = minCoverageOf(reads.values.reserved, reads.values.used);
      const status = reserved >= t.minReservedPercent && used <= t.maxUsedPercent ? 'DETECTED' : 'CLEAR';
      return { side: s.side, label: s.label, status, reserved, used, coverage };
    });

    const detected = results.filter((r) => r.status === 'DETECTED');
    if (detected.length === 0) {
      const failed = results.find((r) => r.status === 'FAILED');
      return failed && failed.status === 'FAILED' ? notEvaluated(failed.reason) : NOT_DETECTED;
    }

    const evidence: EvidenceItem[] = [];
    for (const r of results) {
      if (r.status === 'FAILED') {
        evidence.push({ key: `${r.side}.notEvaluated`, label: `${r.label} not evaluated`, value: r.reason });
        continue;
      }
      evidence.push(
        {
          key: `${r.side}.reservedAverage`,
          label: `Average ${r.label} reserved by pod requests`,
          value: pct(r.reserved),
          unit: '%',
          threshold: `>= ${t.minReservedPercent}`,
        },
        {
          key: `${r.side}.usedAverage`,
          label: `Average ${r.label} actually used`,
          value: pct(r.used),
          unit: '%',
          threshold: `<= ${t.maxUsedPercent}`,
        },
      );
    }
    const coverage = Math.min(...detected.map((r) => (r.status === 'FAILED' ? 1 : r.coverage)));
    evidence.push(
      observationEvidence(obs.observableDays, t.minObservationDays),
      coverageEvidence(coverage, t.minCoverage),
      ...eksClusterEvidence(resource),
    );

    const a = resource.attributes;
    const label = resource.name ?? a.clusterName;
    const summary = detected
      .map((r) =>
        r.status === 'FAILED' ? '' : `${r.label}: ${pct(r.reserved)}% requested vs ${pct(r.used)}% used`,
      )
      .join('; ');
    return {
      outcome: 'DETECTED',
      title: `Pod requests far exceed usage in EKS cluster ${label}`,
      description:
        `In cluster ${a.clusterName}, pod requests reserve much more node capacity than workloads use over ` +
        `${round(obs.observableDays, 0)} days (${summary}). Oversized requests keep nodes looking full, so the ` +
        'scheduler and autoscalers add nodes that are mostly idle.',
      confidence: 'MEDIUM',
      riskLevel: 'MEDIUM',
      evidence,
      suggestedAction: {
        type: 'RIGHTSIZE_POD_REQUESTS',
        summary:
          'Review CPU and memory requests of the largest workloads and align them with observed usage.',
        steps: [
          'Identify the workloads with the largest gap between requests and usage (Container Insights pod metrics, or the Vertical Pod Autoscaler in recommendation mode).',
          'Lower requests gradually in each workload manifest, keeping headroom for peaks; memory limits that are too low cause OOM kills.',
          'Roll the change out through your normal deployment process and watch for throttling, OOM kills and pending pods.',
          'Once requests are smaller, let the cluster autoscaler or Karpenter consolidate nodes.',
        ],
      },
      savingsRequest: null,
    };
  },
});
