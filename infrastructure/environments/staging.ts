import { RemovalPolicy } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { EnvironmentConfig } from './types';

export const staging: Omit<EnvironmentConfig, 'account' | 'region' | 'alarmEmail'> = {
  stage: 'staging',
  removalPolicy: RemovalPolicy.DESTROY,
  logRetention: RetentionDays.ONE_MONTH,
  pointInTimeRecovery: true,
  deletionProtection: false,
  api: { throttleRateLimit: 50, throttleBurstLimit: 100, latencyAlarmP95Ms: 3000 },
  lambda: { standardMemoryMb: 512, largeMemoryMb: 1024, logLevel: 'info' },
  artifacts: { retentionDays: 90, reportRetentionDays: 365, infrequentAccessAfterDays: 30 },
  web: { domainName: undefined, certificateArn: undefined },
  dashboardUrl: undefined,
  workers: { metricsReuseHours: 6, costRefreshHours: 12 },
  alarms: { perFunction: true },
};
