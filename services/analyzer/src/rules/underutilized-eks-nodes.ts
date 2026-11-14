import type { ConfidenceLevel, EvidenceItem, SavingsRequest } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { containerInsightsReason, eksClusterEvidence, eksStateGate, largestNodegroup, totalDesiredNodes } from './eks-shared';
import {
  coverageEvidence,
  minCoverageOf,
  observationEvidence,
  pct,
  readMetric,
  readMetrics,
  requireObservation,
} from './metric-helpers';
import { eksNodeOperatingSystem } from './pricing-attributes';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = {
  maxCpuPercent: 30,
  maxMemoryPercent: 40,
  targetUtilizationPercent: 70,
  minNodes: 2,
  minObservationDays: 14,
  minCoverage: 0.8,
};
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const underutilizedEksNodesRule = defineRule({
  ruleId: 'underutilized-eks-nodes',
  name: 'Underutilized EKS nodes',
  description:
    'EKS cluster whose nodes (Container Insights) stayed lightly used for both CPU and memory, so the same ' +
    'load would fit on fewer nodes. Requires CloudWatch Container Insights.',
  resourceType: 'EKS_CLUSTER',
  category: 'OVERPROVISIONED',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    maxCpuPercent: 'p95 of hourly node_cpu_utilization:Average must be below this value (percent).',
    maxMemoryPercent: 'p95 of hourly node_memory_utilization:Average must be below this value (percent).',
    targetUtilizationPercent:
      'Required nodes = ceil(nodes x max(CPU p95, memory p95) / this value) (percent, minimum 1 node).',
    minNodes: 'Only clusters with at least this many desired nodes across managed node groups are evaluated.',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage: 'Minimum fraction (0-1) of expected hourly datapoints that must be present for each metric.',
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const gate = eksStateGate(resource);
    if (gate) return gate;
    const a = resource.attributes;
    if (a.autoModeEnabled) {
      return notEvaluated('AUTO_MODE_ENABLED: node capacity is managed by EKS Auto Mode');
    }
    const nodes = totalDesiredNodes(a.nodegroups);
    if (nodes < Math.max(1, t.minNodes)) return NOT_DETECTED;

    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);
    const reads = readMetrics(
      resource,
      { cpu: ['node_cpu_utilization', 'Average'], memory: ['node_memory_utilization', 'Average'] },
      t.minCoverage,
    );
    if (!reads.ok) return notEvaluated(containerInsightsReason(reads));
    const cpuP95 = reads.values.cpu.stats.p95;
    const memP95 = reads.values.memory.stats.p95;
    if (cpuP95 === null || memP95 === null) return notEvaluated('METRIC_STATISTICS_INCOMPLETE');
    if (cpuP95 >= t.maxCpuPercent || memP95 >= t.maxMemoryPercent) return NOT_DETECTED;

    const target = t.targetUtilizationPercent > 0 ? t.targetUtilizationPercent : DEFAULTS.targetUtilizationPercent;
    const required = Math.max(1, Math.ceil(round((nodes * Math.max(cpuP95, memP95)) / target, 6)));
    const removable = nodes - required;
    if (removable <= 0) return NOT_DETECTED;

    const coverage = minCoverageOf(reads.values.cpu, reads.values.memory);
    let confidence: ConfidenceLevel = 'MEDIUM';
    const evidence: EvidenceItem[] = [
      {
        key: 'cpu.p95',
        label: 'p95 node CPU utilization',
        value: pct(cpuP95),
        unit: '%',
        threshold: `< ${t.maxCpuPercent}`,
      },
      {
        key: 'memory.p95',
        label: 'p95 node memory utilization',
        value: pct(memP95),
        unit: '%',
        threshold: `< ${t.maxMemoryPercent}`,
      },
      { key: 'nodes.desiredTotal', label: 'Desired nodes (managed node groups)', value: nodes, threshold: `>= ${t.minNodes}` },
      {
        key: 'nodes.required',
        label: 'Nodes needed at target utilization',
        value: required,
        threshold: `${t.targetUtilizationPercent}% target`,
      },
      { key: 'nodes.removable', label: 'Removable nodes', value: removable },
      observationEvidence(obs.observableDays, t.minObservationDays),
      coverageEvidence(coverage, t.minCoverage),
      ...eksClusterEvidence(resource),
    ];
    const minTotal = a.nodegroups.reduce((s, ng) => s + Math.max(0, ng.minSize), 0);
    if (required < minTotal) {
      evidence.push({
        key: 'nodes.minSizeNote',
        label: 'Node group minimum size',
        value: `Node group minimum sizes total ${minTotal}; lower them before scaling below that.`,
      });
    }
    const nodeCount = readMetric(resource, 'cluster_node_count', 'Average', 0);
    if (nodeCount.ok && nodeCount.stats.maximum !== null && nodeCount.stats.maximum > nodes) {
      confidence = 'LOW';
      evidence.push({
        key: 'nodes.outsideNodegroups',
        label: 'Nodes outside managed node groups',
        value: `Container Insights saw up to ${round(nodeCount.stats.maximum, 0)} nodes but managed node groups want ${nodes}; self-managed or Karpenter nodes affect the utilization figures.`,
      });
    }
    if (a.fargateProfileCount > 0) {
      evidence.push({
        key: 'nodes.fargateNote',
        label: 'Fargate',
        value: 'Fargate profiles exist; Fargate pods are not counted in node utilization.',
      });
    }

    let savingsRequest: SavingsRequest | null = null;
    const pricingGroup = largestNodegroup(a.nodegroups);
    const instanceTypes = pricingGroup?.instanceTypes ?? [];
    if (!pricingGroup || instanceTypes.length !== 1) {
      evidence.push({
        key: 'pricing.unsupported',
        label: 'Pricing not available',
        value:
          instanceTypes.length > 1
            ? `Node group ${pricingGroup?.name} uses mixed instance types (${instanceTypes.join(', ')}); the removed node type cannot be determined`
            : 'The instance type of the largest node group is unknown',
      });
    } else {
      evidence.push(
        { key: 'pricing.nodegroup', label: 'Node group used for pricing', value: pricingGroup.name },
        { key: 'pricing.instanceType', label: 'Node instance type', value: instanceTypes[0] ?? null },
        { key: 'pricing.capacityType', label: 'Capacity type', value: pricingGroup.capacityType ?? 'unknown' },
      );
      savingsRequest = {
        kind: 'EKS_NODES_REDUCE',
        region: resource.region,
        instanceType: instanceTypes[0] as string,
        operatingSystem: eksNodeOperatingSystem(pricingGroup.amiType),
        capacityType: pricingGroup.capacityType,
        removableNodes: removable,
      };
    }

    const label = resource.name ?? a.clusterName;
    return {
      outcome: 'DETECTED',
      title: `Underutilized nodes in EKS cluster ${label}`,
      description:
        `Nodes in cluster ${a.clusterName} ran at a p95 of ${pct(cpuP95)}% CPU and ${pct(memP95)}% memory over ` +
        `${round(obs.observableDays, 0)} days. At ${t.targetUtilizationPercent}% target utilization about ${required} of the ` +
        `${nodes} desired nodes would carry the same load, if pod scheduling constraints allow it.`,
      confidence,
      riskLevel: 'MEDIUM',
      evidence,
      suggestedAction: {
        type: 'REDUCE_NODE_COUNT',
        summary: `Consider reducing the cluster from ${nodes} to about ${required} nodes, or let an autoscaler consolidate them.`,
        steps: [
          'Check pod requests, PodDisruptionBudgets, anti-affinity, topology spread and DaemonSets that may require the current node count.',
          'Consider Cluster Autoscaler or Karpenter consolidation so node count follows demand instead of a fixed size.',
          'Lower the node group desired (and, if needed, minimum) size gradually through your infrastructure-as-code, draining nodes before removal.',
          'Monitor pending pods and node utilization after each step.',
        ],
      },
      savingsRequest,
    };
  },
});
