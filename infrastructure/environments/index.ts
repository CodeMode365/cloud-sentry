import type { App } from 'aws-cdk-lib';
import { dev } from './dev';
import { prod } from './prod';
import { staging } from './staging';
import { STAGES, type EnvironmentConfig, type Stage } from './types';

export * from './types';

const BASE: Record<Stage, Omit<EnvironmentConfig, 'account' | 'region' | 'alarmEmail'>> = {
  dev,
  staging,
  prod,
};

/**
 * Resolves configuration for the stage selected with `-c stage=<stage>` (default: dev).
 *
 * Account/region come from CLOUDSENTRY_ACCOUNT / CLOUDSENTRY_REGION, falling back to the CDK CLI's
 * CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION (derived from the deploying credentials). For prod,
 * CLOUDSENTRY_ACCOUNT is required so a deploy can never silently target whichever account the
 * current shell happens to be logged into.
 */
export function loadEnvironment(app: App, env: NodeJS.ProcessEnv = process.env): EnvironmentConfig {
  const stage = String(app.node.tryGetContext('stage') ?? env.CLOUDSENTRY_STAGE ?? 'dev');
  if (!(STAGES as readonly string[]).includes(stage)) {
    throw new Error(`Unknown stage "${stage}". Expected one of: ${STAGES.join(', ')}`);
  }
  const base = BASE[stage as Stage];
  const account = env.CLOUDSENTRY_ACCOUNT ?? env.CDK_DEFAULT_ACCOUNT;
  if (stage === 'prod' && !env.CLOUDSENTRY_ACCOUNT) {
    throw new Error(
      'CLOUDSENTRY_ACCOUNT must be set explicitly when synthesizing or deploying the prod stage',
    );
  }
  if (account !== undefined && !/^\d{12}$/.test(account)) {
    throw new Error(`Invalid AWS account ID "${account}"`);
  }
  const region = env.CLOUDSENTRY_REGION ?? env.CDK_DEFAULT_REGION ?? 'us-east-1';
  const domainName = env.CLOUDSENTRY_WEB_DOMAIN ?? base.web.domainName;
  const certificateArn = env.CLOUDSENTRY_WEB_CERTIFICATE_ARN ?? base.web.certificateArn;
  if ((domainName === undefined) !== (certificateArn === undefined)) {
    throw new Error('CLOUDSENTRY_WEB_DOMAIN and CLOUDSENTRY_WEB_CERTIFICATE_ARN must be set together');
  }
  const dashboardUrl =
    env.CLOUDSENTRY_DASHBOARD_URL ?? base.dashboardUrl ?? (domainName ? `https://${domainName}` : undefined);
  return {
    ...base,
    account,
    region,
    alarmEmail: env.CLOUDSENTRY_ALARM_EMAIL,
    web: { domainName, certificateArn },
    dashboardUrl,
  };
}

/** Physical-name prefix for every resource: cloudsentry-<stage>. */
export function resourcePrefix(config: Pick<EnvironmentConfig, 'stage'>): string {
  return `cloudsentry-${config.stage}`;
}
