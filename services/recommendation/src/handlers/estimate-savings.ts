import { createTrackedStepHandler, createWorkerBase, type WorkerBase } from '@cloudsentry/core';
import type { PriceProvider } from '../pricing';
import { createPricingService } from '../pricing';
import { runEstimateSavingsStep } from '../step-savings';

let base: WorkerBase | undefined;
let pricing: PriceProvider | undefined;
const getBase = () => (base ??= createWorkerBase('cloudsentry-recommendation'));

export const handler = createTrackedStepHandler(getBase, 'EstimateSavings', (b, logger, state) => {
  // Price List API is called with CloudSentry's own role (pricing:GetProducts); results are cached in DynamoDB.
  pricing ??= createPricingService({
    logger: b.logger,
    cache: b.repos.priceCache,
    region: b.config.PRICING_REGION,
  });
  return runEstimateSavingsStep(state, { artifacts: b.artifacts, pricing, logger, now: () => new Date() });
});
