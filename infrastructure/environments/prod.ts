import { RemovalPolicy } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { EnvironmentConfig } from './types';

export const prod: Omit<EnvironmentConfig, 'account' | 'region' | 'alarmEmail'> = {
  stage: 'prod',
  removalPolicy: RemovalPolicy.RETAIN,
  logRetention: RetentionDays.THREE_MONTHS,
  pointInTimeRecovery: true,
  deletionProtection: true,
  api: { throttleRateLimit: 100, throttleBurstLimit: 200, latencyAlarmP95Ms: 3000 },
  lambda: { standardMemoryMb: 512, largeMemoryMb: 1536, logLevel: 'info' },
  artifacts: { retentionDays: 365, reportRetentionDays: 730, infrequentAccessAfterDays: 30 },
  web: { domainName: undefined, certificateArn: undefined },
  dashboardUrl: undefined,
  workers: { metricsReuseHours: 6, costRefreshHours: 12 },
  alarms: { perFunction: true },
};
