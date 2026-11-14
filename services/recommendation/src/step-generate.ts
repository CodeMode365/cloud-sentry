import {
  ARTIFACT_KEYS,
  type ArtifactEnvelope,
  type DetectionResult,
  type ScanWorkflowState,
  type StepArtifactOutput,
} from '@cloudsentry/shared-types';
import type { ArtifactStore } from '@cloudsentry/aws-clients';
import type { Logger } from '@cloudsentry/utilities';
import { assertEnvelopeScope, envelopeFor, MissingStepInputError } from './artifact-scope';
import { generateRecommendations } from './generate';

export interface GenerateRecommendationsStepDeps {
  artifacts: ArtifactStore;
  logger: Logger;
  now: () => Date;
}

/** Step Functions task GenerateRecommendations: findings.json -> recommendations.json. */
export async function runGenerateRecommendationsStep(
  state: ScanWorkflowState,
  deps: GenerateRecommendationsStepDeps,
): Promise<StepArtifactOutput> {
  const prefix = state.validation?.artifactsPrefix;
  const inputKey = state.detection?.artifactKey;
  if (!prefix)
    throw new MissingStepInputError('validation.artifactsPrefix is missing from the workflow state');
  if (!inputKey || state.detection?.status === 'FAILED') {
    throw new MissingStepInputError('Detection results are unavailable; recommendations cannot be generated');
  }
  const envelope = await deps.artifacts.getJson<ArtifactEnvelope<DetectionResult>>(inputKey);
  assertEnvelopeScope(envelope, state, inputKey);
  const drafts = generateRecommendations(envelope.data.issues);
  const outputKey = ARTIFACT_KEYS.recommendations(prefix);
  await deps.artifacts.putJson(outputKey, envelopeFor(state, deps.now(), drafts));
  const counts = { issues: envelope.data.issues.length, recommendations: drafts.length };
  deps.logger.info('Recommendations generated', {
    step: 'GenerateRecommendations',
    scanId: state.scanId,
    ...counts,
  });
  return { status: 'SUCCEEDED', artifactKey: outputKey, counts };
}
