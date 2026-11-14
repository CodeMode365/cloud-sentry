import { RemovalPolicy } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { EnvironmentConfig } from './types';

export const dev: Omit<EnvironmentConfig, 'account' | 'region' | 'alarmEmail'> = {
  stage: 'dev',
  removalPolicy: RemovalPolicy.DESTROY,
  logRetention: RetentionDays.TWO_WEEKS,
  pointInTimeRecovery: false,
  deletionProtection: false,
  api: { throttleRateLimit: 20, throttleBurstLimit: 40, latencyAlarmP95Ms: 5000 },
  lambda: { standardMemoryMb: 512, largeMemoryMb: 1024, logLevel: 'debug' },
  artifacts: { retentionDays: 30, reportRetentionDays: 90, infrequentAccessAfterDays: undefined },
  web: { domainName: undefined, certificateArn: undefined },
  dashboardUrl: undefined,
  workers: { metricsReuseHours: 6, costRefreshHours: 12 },
  alarms: { perFunction: true },
};
