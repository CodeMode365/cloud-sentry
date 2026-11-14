import type { Context } from 'aws-lambda';
import type { DiscoveryWorkerInput, ScanWorkflowState } from '@cloudsentry/shared-types';
import { serializeError } from '@cloudsentry/utilities';
import { workerRuntime, type WorkerRuntime } from './runtime';

/**
 * Wraps a workflow step as a Lambda handler: structured logging with scanId/tenantId/correlation IDs,
 * and errors rethrown so Step Functions Retry/Catch semantics apply.
 */
export function createStepHandler<T, E extends ScanWorkflowState | DiscoveryWorkerInput = ScanWorkflowState>(
  stepName: string,
  fn: (rt: WorkerRuntime, state: E) => Promise<T>,
): (event: E, context?: Context) => Promise<T> {
  return async (event, context) => {
    const base = workerRuntime();
    const logger = base.logger.child({
      step: stepName,
      scanId: event.scanId,
      tenantId: event.tenantId,
      accountId: event.accountId,
      correlationId: event.scanId,
      ...(context?.awsRequestId ? { requestId: context.awsRequestId } : {}),
    });
    const rt: WorkerRuntime = { ...base, logger, ctx: { ...base.ctx, logger } };
    const started = Date.now();
    logger.info('Step started');
    try {
      const out = await fn(rt, event);
      logger.info('Step completed', { durationMs: Date.now() - started });
      return out;
    } catch (error) {
      logger.error('Step failed', { durationMs: Date.now() - started, error: serializeError(error) });
      throw error;
    }
  };
}
