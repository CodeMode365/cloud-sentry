import { createTrackedStepHandler, createWorkerBase, type WorkerBase } from '@cloudsentry/core';
import { runGenerateRecommendationsStep } from '../step-generate';

let base: WorkerBase | undefined;
const getBase = () => (base ??= createWorkerBase('cloudsentry-recommendation'));

export const handler = createTrackedStepHandler(getBase, 'GenerateRecommendations', (b, logger, state) =>
  runGenerateRecommendationsStep(state, { artifacts: b.artifacts, logger, now: () => new Date() }),
);
