import type { RemovalPolicy } from 'aws-cdk-lib';
import type { RetentionDays } from 'aws-cdk-lib/aws-logs';

export const STAGES = ['dev', 'staging', 'prod'] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Environment-specific infrastructure configuration. Nothing here is secret: secrets are created
 * by the stacks (Secrets Manager) or come from the deploying principal's environment.
 */
export interface EnvironmentConfig {
  stage: Stage;
  /** Target AWS account. Undefined = environment-agnostic synthesis (account resolved at deploy time). */
  account: string | undefined;
  region: string;
  /** Applied to stateful resources (table, buckets, user pool, log groups). */
  removalPolicy: RemovalPolicy;
  logRetention: RetentionDays;
  pointInTimeRecovery: boolean;
  deletionProtection: boolean;
  api: {
    throttleRateLimit: number;
    throttleBurstLimit: number;
    /** Alarm when API p95 latency exceeds this for 3 consecutive 5-minute periods. */
    latencyAlarmP95Ms: number;
  };
  /** Optional email subscribed to operational alarms. */
  alarmEmail: string | undefined;
  lambda: {
    standardMemoryMb: number;
    largeMemoryMb: number;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
  artifacts: {
    /** Scan artifacts (scans/ prefix) expire after this many days. */
    retentionDays: number;
    /** Generated reports (reports/ prefix) expire after this many days. */
    reportRetentionDays: number;
    /** Transition to S3 Standard-IA after this many days; undefined disables the transition. */
    infrequentAccessAfterDays: number | undefined;
  };
  web: {
    /** Optional custom domain for the dashboard. Requires certificateArn (ACM, us-east-1). */
    domainName: string | undefined;
    certificateArn: string | undefined;
  };
  /** Public dashboard URL used in notification links. Optional (CloudFront URL is only known after deploy). */
  dashboardUrl: string | undefined;
  workers: {
    metricsReuseHours: number;
    costRefreshHours: number;
  };
  alarms: {
    /** Create Errors/Throttles alarms for every Lambda function (USD 0.10 per alarm-month). */
    perFunction: boolean;
  };
}
