import type {
  FindingCategory,
  NotificationEventType,
  ScanStepName,
  ScheduleFrequency,
  SuggestedActionType,
} from '@cloudsentry/shared-types';

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  IDLE: 'Idle',
  UNUSED: 'Unused',
  OVERPROVISIONED: 'Overprovisioned',
  RETENTION: 'Retention',
};

export const ACTION_LABELS: Record<SuggestedActionType, string> = {
  STOP_INSTANCE: 'Stop instance',
  RIGHTSIZE_INSTANCE: 'Rightsize instance',
  DELETE_VOLUME: 'Delete volume',
  RELEASE_ADDRESS: 'Release Elastic IP',
  RIGHTSIZE_DATABASE: 'Rightsize database',
  STOP_DATABASE: 'Stop database',
  REVIEW_SNAPSHOT_RETENTION: 'Review snapshot retention',
  REVIEW_NAT_GATEWAY: 'Review NAT gateway',
  RIGHTSIZE_FUNCTION_MEMORY: 'Rightsize function memory',
  MIGRATE_TO_ARM64: 'Migrate to arm64 (Graviton)',
  REDUCE_PROVISIONED_CONCURRENCY: 'Reduce provisioned concurrency',
  REVIEW_FUNCTION_DURATION: 'Review function duration',
  DELETE_CLUSTER: 'Delete cluster',
  REDUCE_NODE_COUNT: 'Reduce node count',
  RIGHTSIZE_POD_REQUESTS: 'Rightsize pod requests',
  RIGHTSIZE_CACHE_NODE: 'Rightsize cache nodes',
  DELETE_CACHE_CLUSTER: 'Delete cache cluster',
  REVIEW_DISTRIBUTION: 'Review distribution',
  ENABLE_COMPRESSION: 'Enable compression',
  DELETE_FILE_SYSTEM: 'Delete file system',
  ENABLE_STORAGE_LIFECYCLE: 'Enable storage lifecycle',
  RIGHTSIZE_TABLE_CAPACITY: 'Rightsize table capacity',
  SWITCH_CAPACITY_MODE: 'Switch to on-demand capacity',
  DELETE_TABLE: 'Delete table',
  PAUSE_CLUSTER: 'Pause cluster',
  SCHEDULE_PAUSE_RESUME: 'Schedule pause/resume',
  REDUCE_BACKUP_RETENTION: 'Reduce backup retention',
  CONSOLIDATE_BACKUP_PLANS: 'Consolidate backup plans',
};

export const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  DAILY: 'Daily',
  EVERY_6_HOURS: 'Every 6 hours',
  WEEKLY: 'Weekly',
  CUSTOM: 'Custom cron',
};

export const EVENT_LABELS: Record<NotificationEventType, { title: string; description: string }> = {
  CRITICAL_FINDING: {
    title: 'New critical findings',
    description: 'Findings at or above the minimum severity, sent once per finding.',
  },
  HIGH_VALUE_SAVINGS: {
    title: 'High-value savings',
    description: 'New recommendations whose estimated monthly savings exceed the threshold.',
  },
  SCAN_COMPLETED: {
    title: 'Scan completed',
    description: 'Sent when a scan finishes (completed or partially completed).',
  },
  SCAN_FAILED: { title: 'Scan failed', description: 'Sent when a scan fails.' },
  SCHEDULED_SCAN_SUMMARY: {
    title: 'Scheduled scan summary',
    description: 'A summary after each scheduled scan.',
  },
};

export const STEP_LABELS: Record<ScanStepName, string> = {
  ValidateAccount: 'Validate account',
  AssumeCustomerRole: 'Assume customer role',
  DiscoverResources: 'Resolve regions & discover resources',
  CollectCloudWatchMetrics: 'Collect CloudWatch metrics',
  AnalyzeAWSCosts: 'Analyze AWS costs',
  NormalizeResourceData: 'Normalize resource data',
  ExecuteDetectionRules: 'Execute detection rules',
  GenerateRecommendations: 'Generate recommendations',
  EstimateSavings: 'Estimate savings',
  PersistResults: 'Persist results',
  GenerateScanSummary: 'Generate scan summary',
  SendNotifications: 'Send notifications',
};

export const DAY_OF_WEEK_LABELS: Record<number, string> = {
  1: 'Sunday',
  2: 'Monday',
  3: 'Tuesday',
  4: 'Wednesday',
  5: 'Thursday',
  6: 'Friday',
  7: 'Saturday',
};
