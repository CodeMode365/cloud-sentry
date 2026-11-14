import { join } from 'node:path';
import {
  CustomerAwsClients,
  FileSystemArtifactStore,
  S3ArtifactStore,
  type ArtifactStore,
} from '@cloudsentry/aws-clients';
import {
  LogNotificationGateway,
  NotificationService,
  ScanLifecycle,
  ScanService,
  ScheduleService,
  SnsNotificationGateway,
  StepFunctionsScanStarter,
  type ScanWorkflowStarter,
  type SchedulerGateway,
  type ServiceContext,
} from '@cloudsentry/core';
import { createRepositories, type Repositories } from '@cloudsentry/database';
import type { CloudAccount } from '@cloudsentry/shared-types';
import { createLogger, systemClock, type Clock, type Logger } from '@cloudsentry/utilities';
import { parseEnv, workerEnvSchema, type WorkerEnv } from '@cloudsentry/validators';

/** Everything a workflow step needs. Built once per Lambda container (or once by the local runner). */
export interface WorkerRuntime {
  config: WorkerEnv;
  ctx: ServiceContext;
  repos: Repositories;
  logger: Logger;
  clock: Clock;
  artifacts: ArtifactStore;
  lifecycle: ScanLifecycle;
  notifications: NotificationService;
  schedules: ScheduleService;
  /** Only available where STATE_MACHINE_ARN is configured (scheduled trigger) or injected (local runner). */
  scanService: ScanService | null;
  clientsFor(account: CloudAccount, scanId: string): CustomerAwsClients;
}

const noopScheduler: SchedulerGateway = {
  executesSchedules: false,
  upsert: () => Promise.resolve(),
  delete: () => Promise.resolve(),
};

export interface RuntimeOverrides {
  artifacts?: ArtifactStore;
  repos?: Repositories;
  starter?: ScanWorkflowStarter;
  clientsFor?: (account: CloudAccount, scanId: string) => CustomerAwsClients;
  logger?: Logger;
  clock?: Clock;
}

export function createWorkerRuntime(
  env: NodeJS.ProcessEnv = process.env,
  overrides: RuntimeOverrides = {},
): WorkerRuntime {
  const config = parseEnv(workerEnvSchema, env);
  const logger =
    overrides.logger ?? createLogger({ service: 'cloudsentry-scanner', context: { stage: config.STAGE } });
  const clock = overrides.clock ?? systemClock;
  const repos =
    overrides.repos ??
    createRepositories({
      tableName: config.TABLE_NAME,
      ...(config.DYNAMODB_ENDPOINT ? { endpoint: config.DYNAMODB_ENDPOINT } : {}),
    });
  let artifacts = overrides.artifacts;
  if (!artifacts) {
    if (config.ARTIFACTS_BUCKET) artifacts = new S3ArtifactStore(config.ARTIFACTS_BUCKET);
    else if (config.LOCAL_ARTIFACTS_DIR && config.STAGE === 'local') {
      artifacts = new FileSystemArtifactStore(
        config.LOCAL_ARTIFACTS_DIR,
        'local-only',
        'http://localhost:4000',
      );
    } else throw new Error('ARTIFACTS_BUCKET is required');
  }
  const ctx: ServiceContext = { repos, logger, clock };
  const gateway = config.NOTIFICATIONS_TOPIC_ARN
    ? new SnsNotificationGateway(config.NOTIFICATIONS_TOPIC_ARN)
    : new LogNotificationGateway(logger);
  const starter =
    overrides.starter ??
    (config.STATE_MACHINE_ARN ? new StepFunctionsScanStarter(config.STATE_MACHINE_ARN) : null);
  return {
    config,
    ctx,
    repos,
    logger,
    clock,
    artifacts,
    lifecycle: new ScanLifecycle(ctx),
    notifications: new NotificationService(ctx, gateway, config.DASHBOARD_URL),
    schedules: new ScheduleService(ctx, noopScheduler),
    scanService: starter ? new ScanService(ctx, starter) : null,
    clientsFor:
      overrides.clientsFor ??
      ((account, scanId) =>
        new CustomerAwsClients({
          accountId: account.accountId,
          roleArn: account.roleArn,
          externalId: account.externalId,
          sessionLabel: scanId,
        })),
  };
}

let cached: WorkerRuntime | undefined;
/** Lazily created singleton for Lambda handlers (reused across warm invocations). */
export function workerRuntime(): WorkerRuntime {
  cached ??= createWorkerRuntime();
  return cached;
}

export function localArtifactsDir(root: string): string {
  return join(root, '.local', 'artifacts');
}
