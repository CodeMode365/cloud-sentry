import type { ScanStepName, ScanWorkflowState, StepArtifactOutput } from '@cloudsentry/shared-types';
import { errorMessage } from '@cloudsentry/utilities';
import type { ScanLifecycle } from './scan-lifecycle';

/**
 * Runs a workflow step while recording RUNNING / terminal step status on the scan record.
 * Cancellation is checked before the step starts.
 */
export async function runTrackedStep<T extends StepArtifactOutput>(
  lifecycle: ScanLifecycle,
  state: ScanWorkflowState,
  step: ScanStepName,
  fn: () => Promise<T>,
): Promise<T> {
  await lifecycle.assertActive(state.tenantId, state.scanId);
  const startedAt = new Date().toISOString();
  await lifecycle.step(state.tenantId, state.scanId, step, 'RUNNING', null, startedAt);
  try {
    const out = await fn();
    await lifecycle.step(state.tenantId, state.scanId, step, out.status, out.message ?? null, startedAt);
    return out;
  } catch (error) {
    await lifecycle.step(
      state.tenantId,
      state.scanId,
      step,
      'FAILED',
      errorMessage(error).slice(0, 500),
      startedAt,
    );
    throw error;
  }
}
