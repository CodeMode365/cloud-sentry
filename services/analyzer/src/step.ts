import {
  ARTIFACT_KEYS,
  type ArtifactEnvelope,
  type DetectionResult,
  type DetectionSettings,
  type NormalizedResource,
  type ScanWorkflowState,
  type StepArtifactOutput,
} from '@cloudsentry/shared-types';
import type { ArtifactStore } from '@cloudsentry/aws-clients';
import type { Logger } from '@cloudsentry/utilities';
import { RULES } from './catalog';
import { resolveRuleConfig, runDetection } from './engine';

export interface DetectionStepDeps {
  artifacts: ArtifactStore;
  loadDetectionSettings(tenantId: string): Promise<DetectionSettings | null>;
  logger: Logger;
  now: () => Date;
}

export class MissingStepInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingStepInput';
  }
}

/** Throws when an artifact envelope does not belong to the scan being processed (tenant isolation guard). */
export function assertEnvelopeScope(
  envelope: ArtifactEnvelope<unknown>,
  state: ScanWorkflowState,
  key: string,
): void {
  if (
    envelope.schemaVersion !== 1 ||
    envelope.tenantId !== state.tenantId ||
    envelope.accountId !== state.accountId ||
    envelope.scanId !== state.scanId
  ) {
    throw new Error(`Artifact ${key} does not belong to scan ${state.scanId}`);
  }
}

/** Step Functions task ExecuteDetectionRules: normalized.json -> findings.json. */
export async function runDetectionStep(
  state: ScanWorkflowState,
  deps: DetectionStepDeps,
): Promise<StepArtifactOutput> {
  const prefix = state.validation?.artifactsPrefix;
  const inputKey = state.normalized?.artifactKey;
  if (!prefix)
    throw new MissingStepInputError('validation.artifactsPrefix is missing from the workflow state');
  if (!inputKey || state.normalized?.status === 'FAILED') {
    throw new MissingStepInputError('Normalized resource data is unavailable; detection cannot run');
  }
  const log = deps.logger.child({
    step: 'ExecuteDetectionRules',
    scanId: state.scanId,
    tenantId: state.tenantId,
    accountId: state.accountId,
  });

  const envelope = await deps.artifacts.getJson<ArtifactEnvelope<NormalizedResource[]>>(inputKey);
  assertEnvelopeScope(envelope, state, inputKey);
  const settings = await deps.loadDetectionSettings(state.tenantId);
  for (const rule of RULES) {
    const { ignoredOverrides } = resolveRuleConfig(rule, settings);
    if (ignoredOverrides.length > 0) {
      log.warn('Ignored invalid detection threshold overrides', {
        ruleId: rule.ruleId,
        keys: ignoredOverrides,
      });
    }
  }

  const now = deps.now();
  const result = runDetection(envelope.data, { settings, now });
  const outputKey = ARTIFACT_KEYS.detection(prefix);
  const output: ArtifactEnvelope<DetectionResult> = {
    schemaVersion: 1,
    tenantId: state.tenantId,
    accountId: state.accountId,
    scanId: state.scanId,
    createdAt: now.toISOString(),
    data: result,
  };
  await deps.artifacts.putJson(outputKey, output);

  const notEvaluated = result.evaluations.filter((e) => e.outcome === 'NOT_EVALUATED');
  const ruleErrors = notEvaluated.filter((e) => e.reason?.startsWith('RULE_ERROR'));
  if (ruleErrors.length > 0) {
    log.error('Detection rules raised errors for some resources', {
      count: ruleErrors.length,
      samples: ruleErrors
        .slice(0, 5)
        .map((e) => ({ ruleId: e.ruleId, resourceId: e.resourceId, reason: e.reason })),
    });
  }
  const counts = {
    resources: envelope.data.length,
    issues: result.issues.length,
    evaluated: result.evaluations.length - notEvaluated.length,
    notEvaluated: notEvaluated.length,
    ruleErrors: ruleErrors.length,
  };
  log.info('Detection completed', counts);
  return {
    status: ruleErrors.length > 0 ? 'PARTIAL' : 'SUCCEEDED',
    artifactKey: outputKey,
    counts,
    ...(ruleErrors.length > 0 ? { message: `${ruleErrors.length} rule evaluation(s) failed` } : {}),
  };
}
