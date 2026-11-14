import {
  ARTIFACT_KEYS,
  type ArtifactEnvelope,
  type PricedRecommendationDraft,
  type RecommendationDraft,
  type ScanWorkflowState,
  type StepArtifactOutput,
} from '@cloudsentry/shared-types';
import type { ArtifactStore } from '@cloudsentry/aws-clients';
import { errorMessage, mapSettledWithConcurrency, type Logger } from '@cloudsentry/utilities';
import { assertEnvelopeScope, envelopeFor, MissingStepInputError } from './artifact-scope';
import { memoizePriceProvider } from './pricing/cached';
import { PRICE_UNAVAILABLE, type PriceProvider } from './pricing/provider';
import { COMMON_ASSUMPTIONS, escalateSeverity, estimateSavings } from './savings';

export interface EstimateSavingsStepDeps {
  artifacts: ArtifactStore;
  pricing: PriceProvider;
  logger: Logger;
  now: () => Date;
  /** Concurrent price lookups. Default 4 (Price List API has low request quotas). */
  concurrency?: number;
}

/** Step Functions task EstimateSavings: recommendations.json -> recommendations-priced.json. */
export async function runEstimateSavingsStep(
  state: ScanWorkflowState,
  deps: EstimateSavingsStepDeps,
): Promise<StepArtifactOutput> {
  const prefix = state.validation?.artifactsPrefix;
  const inputKey = state.recommendations?.artifactKey;
  if (!prefix)
    throw new MissingStepInputError('validation.artifactsPrefix is missing from the workflow state');
  if (!inputKey || state.recommendations?.status === 'FAILED') {
    throw new MissingStepInputError('Recommendation drafts are unavailable; savings cannot be estimated');
  }
  const log = deps.logger.child({ step: 'EstimateSavings', scanId: state.scanId, tenantId: state.tenantId });
  const envelope = await deps.artifacts.getJson<ArtifactEnvelope<RecommendationDraft[]>>(inputKey);
  assertEnvelopeScope(envelope, state, inputKey);

  const now = deps.now();
  const pricing = memoizePriceProvider(deps.pricing);
  const settled = await mapSettledWithConcurrency(envelope.data, deps.concurrency ?? 4, (draft) =>
    estimateSavings(draft, pricing, now),
  );
  let errors = 0;
  const priced: PricedRecommendationDraft[] = settled.map((r) => {
    if (r.status === 'fulfilled') return r.value;
    errors++;
    log.error('Savings estimation failed for recommendation', {
      recommendationId: r.item.recommendationId,
      error: errorMessage(r.reason),
    });
    return {
      ...r.item,
      severity: escalateSeverity(r.item.issue.baseSeverity, null),
      savings: {
        status: 'UNAVAILABLE',
        estimateType: 'POINT',
        monthly: null,
        annual: null,
        currency: 'USD',
        method: 'Not calculated',
        assumptions: [...COMMON_ASSUMPTIONS],
        pricingSources: [],
        unavailableReason: `ESTIMATION_ERROR: ${errorMessage(r.reason)}`,
        calculatedAt: now.toISOString(),
      },
    };
  });

  const outputKey = ARTIFACT_KEYS.savings(prefix);
  await deps.artifacts.putJson(outputKey, envelopeFor(state, now, priced));
  const apiErrors = priced.filter((p) =>
    p.savings.unavailableReason?.startsWith(PRICE_UNAVAILABLE.API_ERROR),
  ).length;
  const counts = {
    recommendations: priced.length,
    priced: priced.filter((p) => p.savings.status === 'ESTIMATED').length,
    unavailable: priced.filter((p) => p.savings.status === 'UNAVAILABLE').length,
    priceLookups: pricing.lookups,
    pricingApiErrors: apiErrors,
    errors,
  };
  log.info('Savings estimated', counts);
  const degraded = errors > 0 || apiErrors > 0;
  return {
    status: degraded ? 'PARTIAL' : 'SUCCEEDED',
    artifactKey: outputKey,
    counts,
    ...(degraded
      ? { message: `${errors + apiErrors} recommendation(s) could not be priced because of errors` }
      : {}),
  };
}
