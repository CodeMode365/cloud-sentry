import type { EvidenceItem } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { eksClusterEvidence, eksStateGate, totalDesiredNodes } from './eks-shared';
import { ageInDays, readMetric } from './metric-helpers';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { minAgeDays: 7 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const idleEksClusterRule = defineRule({
  ruleId: 'idle-eks-cluster',
  name: 'Idle EKS cluster',
  description:
    'Active EKS cluster with no managed node group capacity, no Fargate profiles and Auto Mode disabled. ' +
    'The control plane is billed hourly even when no workloads can run. Self-managed nodes are not visible ' +
    'to discovery, so they are ruled out only when Container Insights reports the node count.',
  resourceType: 'EKS_CLUSTER',
  category: 'IDLE',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    minAgeDays: 'Clusters younger than this (days since creation) are not flagged.',
  },
  evaluate(resource, { thresholds, now }) {
    const t = thresholds as Thresholds;
    const gate = eksStateGate(resource);
    if (gate) return gate;
    const a = resource.attributes;
    const desiredNodes = totalDesiredNodes(a.nodegroups);
    if (desiredNodes > 0 || a.fargateProfileCount > 0 || a.autoModeEnabled) return NOT_DETECTED;

    const age = ageInDays(resource.createdAt, now);
    if (age === null) return notEvaluated('CREATION_TIME_UNKNOWN');
    if (age < t.minAgeDays) return NOT_DETECTED;

    // Nodes outside managed node groups (self-managed, Karpenter) are only visible through Container Insights.
    const nodeCount = readMetric(resource, 'cluster_node_count', 'Average', 0);
    if (nodeCount.ok && nodeCount.stats.maximum !== null && nodeCount.stats.maximum > 0) return NOT_DETECTED;

    const evidence: EvidenceItem[] = [
      { key: 'cluster.status', label: 'Cluster status', value: resource.state },
      { key: 'nodes.desiredTotal', label: 'Desired nodes across managed node groups', value: 0, threshold: '= 0' },
      ...eksClusterEvidence(resource),
      { key: 'cluster.ageDays', label: 'Age', value: round(age, 1), unit: 'days', threshold: `>= ${t.minAgeDays}` },
      nodeCount.ok
        ? { key: 'nodes.containerInsightsMax', label: 'Maximum node count (Container Insights)', value: 0 }
        : {
            key: 'nodes.selfManaged',
            label: 'Self-managed nodes',
            value: 'Unknown: Container Insights node count is unavailable, so self-managed or Karpenter nodes cannot be ruled out',
          },
    ];
    if (a.supportType === 'EXTENDED') {
      evidence.push({
        key: 'pricing.extendedSupport',
        label: 'Extended support',
        value:
          'The upgrade policy is EXTENDED. That is a policy, not proof of extended-support billing, so the estimate conservatively uses the standard control-plane rate.',
      });
    }

    const label = resource.name ?? a.clusterName;
    return {
      outcome: 'DETECTED',
      title: `Idle EKS cluster ${label}`,
      description:
        `Cluster ${a.clusterName} has been ACTIVE for ${round(age, 0)} days with no managed node group capacity, ` +
        'no Fargate profiles and Auto Mode disabled, so it cannot run workloads on managed compute. ' +
        'The EKS control plane is billed per hour regardless.',
      confidence: 'MEDIUM',
      riskLevel: 'HIGH',
      evidence,
      suggestedAction: {
        type: 'DELETE_CLUSTER',
        summary: 'Confirm the cluster is no longer needed, then delete it after exporting any configuration you want to keep.',
        steps: [
          'Check for self-managed nodes (EC2 Auto Scaling groups joined to the cluster) or Karpenter-provisioned nodes, which this check cannot always see.',
          'Confirm with the owner that no environment, CI/CD pipeline or GitOps controller depends on the cluster endpoint.',
          'Back up Kubernetes manifests, Helm releases, secrets and IAM/access entries you may need to recreate it.',
          'Delete remaining load balancers, persistent volumes and add-ons created by the cluster, then delete the cluster.',
        ],
      },
      savingsRequest: { kind: 'EKS_CLUSTER_DELETE', region: resource.region, supportType: 'STANDARD' },
    };
  },
});
