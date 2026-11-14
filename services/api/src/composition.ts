import { join } from 'node:path';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import {
  FileSystemArtifactStore,
  S3ArtifactStore,
  StsRoleVerifier,
  type ArtifactStore,
  type RoleVerifier,
} from '@cloudsentry/aws-clients';
import {
  AccountService,
  AnalyticsService,
  AuthService,
  CognitoIdentityProvider,
  EventBridgeSchedulerGateway,
  InventoryService,
  LambdaReportTrigger,
  LocalIdentityProvider,
  LocalSchedulerGateway,
  LogNotificationGateway,
  ReportService,
  ScanService,
  ScheduleService,
  SettingsService,
  SnsNotificationGateway,
  StaticPlatformIdentity,
  StepFunctionsScanStarter,
  StsPlatformIdentity,
  type IdentityProvider,
  type ReportTrigger,
  type ScanWorkflowStarter,
  type SchedulerGateway,
  type ServiceContext,
} from '@cloudsentry/core';
import { getRuleCatalog } from '@cloudsentry/analyzer';
import { createRepositories, type Repositories } from '@cloudsentry/database';
import { UpstreamError, createLogger, systemClock, type Logger } from '@cloudsentry/utilities';
import { apiEnvSchema, parseEnv, type ApiEnv } from '@cloudsentry/validators';

export interface ApiServices {
  config: ApiEnv;
  logger: Logger;
  repos: Repositories;
  artifacts: ArtifactStore;
  auth: AuthService;
  accounts: AccountService;
  scans: ScanService;
  inventory: InventoryService;
  analytics: AnalyticsService;
  schedules: ScheduleService;
  reports: ReportService;
  settings: SettingsService;
}

export interface ApiOverrides {
  starter?: ScanWorkflowStarter;
  reportTrigger?: ReportTrigger;
  artifacts?: ArtifactStore;
  roleVerifier?: RoleVerifier;
  identityProvider?: IdentityProvider;
  logger?: Logger;
  repos?: Repositories;
}

/** Fails at call time (not cold start) when a dependency is not configured for this function. */
function unconfigured<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === 'executesSchedules') return false;
      return () => Promise.reject(new UpstreamError(`${name} is not configured for this function`));
    },
  });
}

function secretFetcher(secretArn: string): () => Promise<string> {
  let cached: Promise<string> | undefined;
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION, maxAttempts: 3 });
  return () => {
    cached ??= client
      .send(new GetSecretValueCommand({ SecretId: secretArn }))
      .then((out) => {
        const raw = out.SecretString ?? '';
        try {
          const parsed = JSON.parse(raw) as { clientSecret?: string };
          return parsed.clientSecret ?? raw;
        } catch {
          return raw;
        }
      })
      .catch((error: unknown) => {
        cached = undefined;
        throw error;
      });
    return cached;
  };
}

export function buildApiServices(
  env: NodeJS.ProcessEnv = process.env,
  overrides: ApiOverrides = {},
): ApiServices {
  const config = parseEnv(apiEnvSchema, env);
  const logger =
    overrides.logger ?? createLogger({ service: 'cloudsentry-api', context: { stage: config.STAGE } });
  const repos =
    overrides.repos ??
    createRepositories({
      tableName: config.TABLE_NAME,
      ...(config.DYNAMODB_ENDPOINT ? { endpoint: config.DYNAMODB_ENDPOINT } : {}),
    });
  const ctx: ServiceContext = { repos, logger, clock: systemClock };
  const isLocal = config.STAGE === 'local';

  let artifacts = overrides.artifacts;
  if (!artifacts) {
    if (config.ARTIFACTS_BUCKET) artifacts = new S3ArtifactStore(config.ARTIFACTS_BUCKET);
    else if (isLocal && config.LOCAL_ARTIFACTS_DIR) {
      artifacts = new FileSystemArtifactStore(
        config.LOCAL_ARTIFACTS_DIR,
        config.LOCAL_JWT_SECRET ?? 'local-only',
        'http://localhost:4000',
      );
    } else artifacts = unconfigured<ArtifactStore>('Artifact storage');
  }

  let idp = overrides.identityProvider;
  if (!idp) {
    if (config.AUTH_MODE === 'local') {
      if (!isLocal || !config.LOCAL_JWT_SECRET)
        throw new Error('AUTH_MODE=local requires STAGE=local and LOCAL_JWT_SECRET');
      idp = new LocalIdentityProvider(
        join(process.cwd(), '.local', 'auth-users.json'),
        config.LOCAL_JWT_SECRET,
        logger,
      );
    } else {
      if (!config.USER_POOL_ID || !config.USER_POOL_CLIENT_ID)
        throw new Error('USER_POOL_ID and USER_POOL_CLIENT_ID are required');
      idp = new CognitoIdentityProvider({
        userPoolId: config.USER_POOL_ID,
        clientId: config.USER_POOL_CLIENT_ID,
        region: config.AWS_REGION,
        getClientSecret: config.USER_POOL_CLIENT_SECRET_ARN
          ? secretFetcher(config.USER_POOL_CLIENT_SECRET_ARN)
          : () =>
              Promise.reject(new UpstreamError('Cognito client secret is not configured for this function')),
      });
    }
  }

  const scheduler: SchedulerGateway =
    config.SCHEDULER_GROUP_NAME && config.SCHEDULER_ROLE_ARN && config.SCHEDULED_SCAN_FUNCTION_ARN
      ? new EventBridgeSchedulerGateway({
          groupName: config.SCHEDULER_GROUP_NAME,
          roleArn: config.SCHEDULER_ROLE_ARN,
          targetFunctionArn: config.SCHEDULED_SCAN_FUNCTION_ARN,
        })
      : isLocal
        ? new LocalSchedulerGateway(logger)
        : unconfigured<SchedulerGateway>('EventBridge Scheduler');
  const starter =
    overrides.starter ??
    (config.STATE_MACHINE_ARN
      ? new StepFunctionsScanStarter(config.STATE_MACHINE_ARN)
      : unconfigured<ScanWorkflowStarter>('Scan workflow'));
  const notifications = config.NOTIFICATIONS_TOPIC_ARN
    ? new SnsNotificationGateway(config.NOTIFICATIONS_TOPIC_ARN)
    : new LogNotificationGateway(logger);
  const reportTrigger =
    overrides.reportTrigger ??
    (config.REPORT_FUNCTION_NAME
      ? new LambdaReportTrigger(config.REPORT_FUNCTION_NAME)
      : unconfigured<ReportTrigger>('Report generation'));
  const platform = config.PLATFORM_ACCOUNT_ID
    ? new StaticPlatformIdentity(config.PLATFORM_ACCOUNT_ID)
    : new StsPlatformIdentity();

  const schedules = new ScheduleService(ctx, scheduler);
  return {
    config,
    logger,
    repos,
    artifacts,
    auth: new AuthService(ctx, idp),
    accounts: new AccountService(
      ctx,
      overrides.roleVerifier ?? new StsRoleVerifier(logger),
      platform,
      schedules,
    ),
    scans: new ScanService(ctx, starter),
    inventory: new InventoryService(ctx),
    analytics: new AnalyticsService(ctx),
    schedules,
    reports: new ReportService(ctx, reportTrigger, artifacts),
    settings: new SettingsService(ctx, getRuleCatalog(), notifications),
  };
}

let cached: ApiServices | undefined;
export function apiServices(): ApiServices {
  cached ??= buildApiServices();
  return cached;
}
