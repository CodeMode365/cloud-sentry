/**
 * Canonical enumerations shared by every CloudSentry component.
 * Declared as readonly tuples so they can drive both TypeScript unions and Zod enums.
 */

export const RESOURCE_TYPES = [
  'EC2_INSTANCE',
  'EBS_VOLUME',
  'ELASTIC_IP',
  'RDS_INSTANCE',
  'EBS_SNAPSHOT',
  'NAT_GATEWAY',
  'LOAD_BALANCER',
  'LAMBDA_FUNCTION',
  'EKS_CLUSTER',
  'ELASTICACHE_CLUSTER',
  'CLOUDFRONT_DISTRIBUTION',
  'EFS_FILE_SYSTEM',
  'DYNAMODB_TABLE',
  'REDSHIFT_CLUSTER',
  'BACKUP_PLAN',
  'BACKUP_VAULT',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * Global services are discovered once per scan (not per region). Their resources use region "global";
 * their CloudWatch metrics live in us-east-1.
 */
export const GLOBAL_RESOURCE_TYPES: readonly ResourceType[] = ['CLOUDFRONT_DISTRIBUTION'];
export const GLOBAL_REGION = 'global';
export const GLOBAL_METRICS_REGION = 'us-east-1';

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  EC2_INSTANCE: 'EC2 Instance',
  EBS_VOLUME: 'EBS Volume',
  ELASTIC_IP: 'Elastic IP',
  RDS_INSTANCE: 'RDS Instance',
  EBS_SNAPSHOT: 'EBS Snapshot',
  NAT_GATEWAY: 'NAT Gateway',
  LOAD_BALANCER: 'Load Balancer',
  LAMBDA_FUNCTION: 'Lambda Function',
  EKS_CLUSTER: 'EKS Cluster',
  ELASTICACHE_CLUSTER: 'ElastiCache Cluster',
  CLOUDFRONT_DISTRIBUTION: 'CloudFront Distribution',
  EFS_FILE_SYSTEM: 'EFS File System',
  DYNAMODB_TABLE: 'DynamoDB Table',
  REDSHIFT_CLUSTER: 'Redshift Cluster',
  BACKUP_PLAN: 'Backup Plan',
  BACKUP_VAULT: 'Backup Vault',
};

export const SCAN_STATUSES = [
  'PENDING',
  'RUNNING',
  'PARTIALLY_COMPLETED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];
export const TERMINAL_SCAN_STATUSES: readonly ScanStatus[] = [
  'PARTIALLY_COMPLETED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

export const SCAN_TRIGGERS = ['MANUAL', 'SCHEDULED'] as const;
export type ScanTrigger = (typeof SCAN_TRIGGERS)[number];

export const ACCOUNT_STATUSES = ['PENDING_VERIFICATION', 'CONNECTED', 'ERROR'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Where an account's data comes from. SYNTHETIC is only ever created by the local seed script. */
export const DATA_SOURCES = ['AWS', 'SYNTHETIC'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CONFIDENCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const FINDING_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'SUPPRESSED', 'RESOLVED'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];
/** Statuses a user may set through the API. RESOLVED is system-managed. */
export const USER_SETTABLE_FINDING_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'SUPPRESSED'] as const;

export const FINDING_CATEGORIES = ['IDLE', 'UNUSED', 'OVERPROVISIONED', 'RETENTION'] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const RECOMMENDATION_STATUSES = ['OPEN', 'UNDER_REVIEW', 'ACCEPTED', 'DISMISSED', 'RESOLVED'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];
/** Statuses a user may set through the API. RESOLVED is system-managed. */
export const USER_SETTABLE_RECOMMENDATION_STATUSES = [
  'OPEN',
  'UNDER_REVIEW',
  'ACCEPTED',
  'DISMISSED',
] as const;

export const USER_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const SCHEDULE_FREQUENCIES = ['DAILY', 'EVERY_6_HOURS', 'WEEKLY', 'CUSTOM'] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const SCHEDULE_STATUSES = ['ACTIVE', 'DISABLED', 'ERROR'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const REPORT_TYPES = ['ON_DEMAND', 'WEEKLY', 'MONTHLY'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_FORMATS = ['PDF', 'JSON'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const REPORT_STATUSES = ['PENDING', 'GENERATING', 'READY', 'FAILED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const NOTIFICATION_EVENT_TYPES = [
  'CRITICAL_FINDING',
  'HIGH_VALUE_SAVINGS',
  'SCAN_COMPLETED',
  'SCAN_FAILED',
  'SCHEDULED_SCAN_SUMMARY',
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export const SUGGESTED_ACTION_TYPES = [
  'STOP_INSTANCE',
  'RIGHTSIZE_INSTANCE',
  'DELETE_VOLUME',
  'RELEASE_ADDRESS',
  'RIGHTSIZE_DATABASE',
  'STOP_DATABASE',
  'REVIEW_SNAPSHOT_RETENTION',
  'REVIEW_NAT_GATEWAY',
  'RIGHTSIZE_FUNCTION_MEMORY',
  'MIGRATE_TO_ARM64',
  'REDUCE_PROVISIONED_CONCURRENCY',
  'REVIEW_FUNCTION_DURATION',
  'DELETE_CLUSTER',
  'REDUCE_NODE_COUNT',
  'RIGHTSIZE_POD_REQUESTS',
  'RIGHTSIZE_CACHE_NODE',
  'DELETE_CACHE_CLUSTER',
  'REVIEW_DISTRIBUTION',
  'ENABLE_COMPRESSION',
  'DELETE_FILE_SYSTEM',
  'ENABLE_STORAGE_LIFECYCLE',
  'RIGHTSIZE_TABLE_CAPACITY',
  'SWITCH_CAPACITY_MODE',
  'DELETE_TABLE',
  'PAUSE_CLUSTER',
  'SCHEDULE_PAUSE_RESUME',
  'REDUCE_BACKUP_RETENTION',
  'CONSOLIDATE_BACKUP_PLANS',
] as const;
export type SuggestedActionType = (typeof SUGGESTED_ACTION_TYPES)[number];

export const SEVERITY_ORDER: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
export const CONFIDENCE_ORDER: Record<ConfidenceLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
