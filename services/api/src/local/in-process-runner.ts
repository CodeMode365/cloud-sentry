import { runDetectionStep } from '@cloudsentry/analyzer';
import { runTrackedStep, type ScanWorkflowStarter } from '@cloudsentry/core';
import {
  createPricingService,
  runEstimateSavingsStep,
  runGenerateRecommendationsStep,
  type PriceProvider,
} from '@cloudsentry/recommendation';
import {
  analyzeCosts,
  assumeCustomerRole,
  collectMetrics,
  discoverType,
  generateSummary,
  markScanFailed,
  normalize,
  persistResults,
  resolveRegions,
  sendNotifications,
  validateAccount,
  type WorkerRuntime,
} from '@cloudsentry/scanner';
import {
  RESOURCE_TYPES,
  type DiscoveryWorkerOutput,
  type ScanWorkflowInput,
  type ScanWorkflowState,
  type StepArtifactOutput,
} from '@cloudsentry/shared-types';
import { awsErrorName, errorMessage } from '@cloudsentry/utilities';

/**
 * LOCAL DEVELOPMENT ONLY. Executes the same step functions the Step Functions state machine invokes,
 * in the same order, emulating Parallel discovery and the Catch semantics defined in the CDK workflow.
 * Real AWS calls are made with the developer's local credentials (AssumeRole into the customer role).
 */
export class InProcessScanStarter implements ScanWorkflowStarter {
  private pricing: PriceProvider | undefined;

  constructor(private readonly rt: () => WorkerRuntime) {}

  start(input: ScanWorkflowInput): Promise<{ executionArn: string }> {
    setImmediate(() => {
      void this.execute(input);
    });
    return Promise.resolve({ executionArn: `local:execution:${input.scanId}` });
  }

  stop(): Promise<void> {
    // Steps check the scan's CANCELLED status before running, so the run stops at the next step.
    return Promise.resolve();
  }

  /** Runs the full workflow for an already-created scan record. Never throws (failures mark the scan FAILED). */
  async execute(input: ScanWorkflowInput): Promise<void> {
    const rt = this.rt();
    const logger = rt.logger.child({ scanId: input.scanId, tenantId: input.tenantId, runner: 'in-process' });
    const state: ScanWorkflowState = { ...input };
    const soft = async (p: Promise<StepArtifactOutput>): Promise<StepArtifactOutput> => {
      try {
        return await p;
      } catch (error) {
        logger.warn('Step failed; continuing (Catch -> Pass)', { error: errorMessage(error) });
        return { status: 'FAILED', artifactKey: null, message: errorMessage(error) };
      }
    };
    try {
      state.validation = await validateAccount(rt, state);
      state.role = await assumeCustomerRole(rt, state);
      state.regionsResolved = await resolveRegions(rt, state);
      state.discovery = await Promise.all(
        RESOURCE_TYPES.map((t) =>
          discoverType(rt, t, state).catch((error: unknown): DiscoveryWorkerOutput => ({
            resourceType: t,
            status: 'FAILED',
            resourceCount: 0,
            regionsSucceeded: [],
            regionsFailed: [],
            artifactKey: null,
            durationMs: 0,
            errorMessage: errorMessage(error),
          })),
        ),
      );
      state.metrics = await soft(collectMetrics(rt, state));
      state.costs = await soft(analyzeCosts(rt, state));
      state.normalized = await normalize(rt, state);
      const deps = { artifacts: rt.artifacts, logger, now: () => new Date() };
      state.detection = await runTrackedStep(rt.lifecycle, state, 'ExecuteDetectionRules', () =>
        runDetectionStep(state, {
          ...deps,
          loadDetectionSettings: (t) => rt.repos.settings.getDetectionSettings(t),
        }),
      );
      state.recommendations = await runTrackedStep(rt.lifecycle, state, 'GenerateRecommendations', () =>
        runGenerateRecommendationsStep(state, deps),
      );
      this.pricing ??= createPricingService({ logger: rt.logger, cache: rt.repos.priceCache });
      const pricing = this.pricing;
      state.savings = await runTrackedStep(rt.lifecycle, state, 'EstimateSavings', () =>
        runEstimateSavingsStep(state, { ...deps, pricing }),
      );
      state.persisted = await persistResults(rt, state);
      state.summary = await generateSummary(rt, state);
      state.notifications = await sendNotifications(rt, state);
      logger.info('Local scan finished', { status: state.summary.message });
    } catch (error) {
      state.error = {
        Error: awsErrorName(error) ?? 'Error',
        Cause: JSON.stringify({ errorMessage: errorMessage(error) }),
      };
      try {
        await markScanFailed(rt, state);
      } catch (inner) {
        logger.error('Failed to mark scan failed', { error: inner });
      }
    }
  }
}
