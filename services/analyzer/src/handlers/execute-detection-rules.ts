import { createTrackedStepHandler, createWorkerBase, type WorkerBase } from '@cloudsentry/core';
import { runDetectionStep } from '../step';

let base: WorkerBase | undefined;
const getBase = () => (base ??= createWorkerBase('cloudsentry-analyzer'));

export const handler = createTrackedStepHandler(getBase, 'ExecuteDetectionRules', (b, logger, state) =>
  runDetectionStep(state, {
    artifacts: b.artifacts,
    loadDetectionSettings: (tenantId) => b.repos.settings.getDetectionSettings(tenantId),
    logger,
    now: () => new Date(),
  }),
);
