import type { ThresholdValues } from './findings';

export interface RuleSettings {
  enabled: boolean;
  /** Overrides merged over each rule's defaults. */
  thresholds: ThresholdValues;
}

export interface DetectionSettings {
  tenantId: string;
  /** Default metric lookback for scans (days). */
  lookbackDays: number;
  /** Resources with this tag key set to "true" are excluded from all rules. */
  ignoreTagKey: string;
  rules: Record<string, RuleSettings>;
  updatedAt: string;
  version: number;
}

export const DEFAULT_LOOKBACK_DAYS = 30;
export const DEFAULT_IGNORE_TAG_KEY = 'cloudsentry:ignore';
