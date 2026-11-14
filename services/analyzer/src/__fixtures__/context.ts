import type { NormalizedResource, ThresholdValues } from '@cloudsentry/shared-types';
import { buildResourceIndex } from '../engine';
import type { RuleContext } from '../rules/types';
import { FIXTURE_NOW } from './resources';

export function ctxFor(
  defaults: ThresholdValues,
  overrides: ThresholdValues = {},
  all: NormalizedResource[] = [],
  now: Date = FIXTURE_NOW,
): RuleContext {
  return { thresholds: { ...defaults, ...overrides }, now, index: buildResourceIndex(all) };
}
