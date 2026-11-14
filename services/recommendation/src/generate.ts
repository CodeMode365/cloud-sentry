import type { DetectedIssue, RecommendationDraft, SuggestedActionType } from '@cloudsentry/shared-types';
import { recommendationIdFor } from '@cloudsentry/utilities';

const TITLE_BY_ACTION: Record<SuggestedActionType, (label: string, issue: DetectedIssue) => string> = {
  STOP_INSTANCE: (l) => `Stop idle EC2 instance ${l}`,
  RIGHTSIZE_INSTANCE: (l) => `Rightsize EC2 instance ${l}`,
  DELETE_VOLUME: (l) => `Delete unattached EBS volume ${l}`,
  RELEASE_ADDRESS: (l) => `Release unassociated Elastic IP ${l}`,
  RIGHTSIZE_DATABASE: (l) => `Downsize RDS instance ${l}`,
  STOP_DATABASE: (l) => `Stop or remove unused RDS instance ${l}`,
  REVIEW_SNAPSHOT_RETENTION: (l) => `Review retention of EBS snapshot ${l}`,
  REVIEW_NAT_GATEWAY: (l) => `Review low-traffic NAT Gateway ${l}`,
  RIGHTSIZE_FUNCTION_MEMORY: (l) => `Reduce memory of Lambda function ${l}`,
  MIGRATE_TO_ARM64: (l) => `Migrate Lambda function ${l} to arm64 (Graviton)`,
  REDUCE_PROVISIONED_CONCURRENCY: (l) => `Reduce idle provisioned concurrency of Lambda function ${l}`,
  REVIEW_FUNCTION_DURATION: (l) => `Review execution duration of Lambda function ${l}`,
  DELETE_CLUSTER: (l) => `Delete idle EKS cluster ${l}`,
  REDUCE_NODE_COUNT: (l) => `Reduce underutilized worker nodes in EKS cluster ${l}`,
  RIGHTSIZE_POD_REQUESTS: (l) => `Rightsize pod resource requests in EKS cluster ${l}`,
  RIGHTSIZE_CACHE_NODE: (l) => `Downsize ElastiCache cluster ${l}`,
  DELETE_CACHE_CLUSTER: (l) => `Delete idle ElastiCache cluster ${l}`,
  REVIEW_DISTRIBUTION: (l) => `Review idle CloudFront distribution ${l}`,
  ENABLE_COMPRESSION: (l) => `Enable compression on CloudFront distribution ${l}`,
  DELETE_FILE_SYSTEM: (l) => `Delete unused EFS file system ${l}`,
  ENABLE_STORAGE_LIFECYCLE: (l) => `Enable lifecycle management on EFS file system ${l}`,
  RIGHTSIZE_TABLE_CAPACITY: (l) => `Reduce provisioned capacity of DynamoDB table ${l}`,
  SWITCH_CAPACITY_MODE: (l) => `Switch DynamoDB table ${l} to on-demand capacity`,
  DELETE_TABLE: (l) => `Delete unused DynamoDB table ${l}`,
  PAUSE_CLUSTER: (l) => `Pause idle Redshift cluster ${l}`,
  SCHEDULE_PAUSE_RESUME: (l) => `Schedule pause and resume for Redshift cluster ${l}`,
  REDUCE_BACKUP_RETENTION: (l, issue) =>
    issue.resourceType === 'BACKUP_VAULT'
      ? `Reduce retention of old recovery points in backup vault ${l}`
      : `Reduce backup retention in backup plan ${l}`,
  CONSOLIDATE_BACKUP_PLANS: (l) => `Consolidate overlapping backup plans for backup vault ${l}`,
};

/** Action-specific caution appended to the description (null: the issue's own summary is sufficient). */
const NOTE_BY_ACTION: Record<SuggestedActionType, string | null> = {
  STOP_INSTANCE: null,
  RIGHTSIZE_INSTANCE: null,
  DELETE_VOLUME: null,
  RELEASE_ADDRESS: null,
  RIGHTSIZE_DATABASE: null,
  STOP_DATABASE: null,
  REVIEW_SNAPSHOT_RETENTION: null,
  REVIEW_NAT_GATEWAY: null,
  RIGHTSIZE_FUNCTION_MEMORY:
    'Lower memory also means less CPU; measure duration after the change, since longer runs reduce the savings.',
  MIGRATE_TO_ARM64: 'Test on arm64 first: the code, native dependencies and layers must support arm64.',
  REDUCE_PROVISIONED_CONCURRENCY:
    'Requests above the new allocation are served by on-demand concurrency and may see cold starts.',
  REVIEW_FUNCTION_DURATION: null,
  DELETE_CLUSTER:
    'Deleting a cluster cannot be undone; confirm that no workloads, pipelines or GitOps tools still target it.',
  REDUCE_NODE_COUNT:
    'Make sure the remaining nodes can schedule every pod (requests, daemonsets, affinity and disruption budgets) before scaling in.',
  RIGHTSIZE_POD_REQUESTS: null,
  RIGHTSIZE_CACHE_NODE: 'Make sure the smaller node type has enough memory for the dataset and replication.',
  DELETE_CACHE_CLUSTER:
    'For Redis OSS or Valkey, create a final backup before deleting if the data may still be needed.',
  REVIEW_DISTRIBUTION: null,
  ENABLE_COMPRESSION: null,
  DELETE_FILE_SYSTEM: 'Deletion permanently removes all files; back up the file system first if the data may be needed.',
  ENABLE_STORAGE_LIFECYCLE:
    'Infrequent Access storage charges for each read and write, so keep frequently accessed data in Standard.',
  RIGHTSIZE_TABLE_CAPACITY:
    'Too little capacity causes throttling; consider auto scaling instead of a fixed lower value.',
  SWITCH_CAPACITY_MODE: 'On-demand cost grows with request volume; re-evaluate if traffic increases.',
  DELETE_TABLE: 'Deletion permanently removes all items; export the table or create a backup first.',
  PAUSE_CLUSTER: 'A paused cluster cannot run queries until it is resumed; managed storage remains billed.',
  SCHEDULE_PAUSE_RESUME: 'Align the schedule with the hours when nobody queries the cluster.',
  REDUCE_BACKUP_RETENTION:
    'Confirm legal, regulatory and business retention requirements before shortening retention or deleting recovery points.',
  CONSOLIDATE_BACKUP_PLANS: 'Keep at least one plan that meets the strictest retention requirement for each resource.',
};

const READ_ONLY_NOTICE =
  'CloudSentry is read-only and never changes your resources; review the evidence and perform any change yourself.';

/** Converts one detected issue into an actionable recommendation draft (pure, deterministic). */
export function recommendationFor(issue: DetectedIssue): RecommendationDraft {
  const label = issue.resourceName ?? issue.resourceId;
  return {
    recommendationId: recommendationIdFor(issue.findingId),
    findingId: issue.findingId,
    issue,
    title: TITLE_BY_ACTION[issue.suggestedAction.type](label, issue),
    description: [issue.description, issue.suggestedAction.summary, NOTE_BY_ACTION[issue.suggestedAction.type], READ_ONLY_NOTICE]
      .filter((part): part is string => Boolean(part))
      .join(' '),
    suggestedAction: issue.suggestedAction,
    confidence: issue.confidence,
    riskLevel: issue.riskLevel,
  };
}

/** One recommendation per finding; duplicate finding IDs keep the first occurrence. */
export function generateRecommendations(issues: readonly DetectedIssue[]): RecommendationDraft[] {
  const seen = new Set<string>();
  const drafts: RecommendationDraft[] = [];
  for (const issue of issues) {
    if (seen.has(issue.findingId)) continue;
    seen.add(issue.findingId);
    drafts.push(recommendationFor(issue));
  }
  return drafts;
}
