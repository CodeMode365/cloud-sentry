import { FileSystemArtifactStore, S3ArtifactStore, type ArtifactStore } from '@cloudsentry/aws-clients';
import { createRepositories, type Repositories } from '@cloudsentry/database';
import type { ScanWorkflowState, ScanStepName, StepArtifactOutput } from '@cloudsentry/shared-types';
import { createLogger, serializeError, systemClock, type Logger } from '@cloudsentry/utilities';
import { parseEnv, workerEnvSchema, type WorkerEnv } from '@cloudsentry/validators';
import type { ServiceContext } from './context';
import { ScanLifecycle } from './scans/scan-lifecycle';
import { runTrackedStep } from './scans/tracked-step';

export interface WorkerBase {
  config: WorkerEnv;
  logger: Logger;
  repos: Repositories;
  artifacts: ArtifactStore;
  ctx: ServiceContext;
  lifecycle: ScanLifecycle;
}

export function createWorkerBase(service: string, env: NodeJS.ProcessEnv = process.env): WorkerBase {
  const config = parseEnv(workerEnvSchema, env);
  const logger = createLogger({ service, context: { stage: config.STAGE } });
  const repos = createRepositories({
    tableName: config.TABLE_NAME,
    ...(config.DYNAMODB_ENDPOINT ? { endpoint: config.DYNAMODB_ENDPOINT } : {}),
  });
  let artifacts: ArtifactStore;
  if (config.ARTIFACTS_BUCKET) artifacts = new S3ArtifactStore(config.ARTIFACTS_BUCKET);
  else if (config.LOCAL_ARTIFACTS_DIR && config.STAGE === 'local') {
    artifacts = new FileSystemArtifactStore(
      config.LOCAL_ARTIFACTS_DIR,
      'local-only',
      'http://localhost:4000',
    );
  } else throw new Error('ARTIFACTS_BUCKET is required');
  const ctx: ServiceContext = { repos, logger, clock: systemClock };
  return { config, logger, repos, artifacts, ctx, lifecycle: new ScanLifecycle(ctx) };
}

/** Builds a Step Functions task handler that records step status and logs with scan correlation IDs. */
export function createTrackedStepHandler(
  getBase: () => WorkerBase,
  step: ScanStepName,
  fn: (base: WorkerBase, logger: Logger, state: ScanWorkflowState) => Promise<StepArtifactOutput>,
): (event: ScanWorkflowState) => Promise<StepArtifactOutput> {
  return async (event) => {
    const base = getBase();
    const logger = base.logger.child({
      step,
      scanId: event.scanId,
      tenantId: event.tenantId,
      accountId: event.accountId,
      correlationId: event.scanId,
    });
    const started = Date.now();
    try {
      const out = await runTrackedStep(base.lifecycle, event, step, () => fn(base, logger, event));
      logger.info('Step completed', {
        durationMs: Date.now() - started,
        status: out.status,
        counts: out.counts,
      });
      return out;
    } catch (error) {
      logger.error('Step failed', { durationMs: Date.now() - started, error: serializeError(error) });
      throw error;
    }
  };
}
