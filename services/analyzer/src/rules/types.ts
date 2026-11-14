import type {
  ConfidenceLevel,
  EvidenceItem,
  FindingCategory,
  NormalizedResource,
  ResourceType,
  RiskLevel,
  SavingsRequest,
  Severity,
  SuggestedAction,
  ThresholdValues,
} from '@cloudsentry/shared-types';

/** Lookup structures shared by every rule during one detection run (built once per run). */
export interface ResourceIndex {
  all: readonly NormalizedResource[];
  /** Snapshots keyed by `${accountId}|${region}|${volumeId}`. */
  snapshotsByVolume: ReadonlyMap<string, readonly NormalizedResource[]>;
}

export interface RuleContext {
  /** Effective thresholds (defaults merged with tenant overrides). */
  thresholds: ThresholdValues;
  now: Date;
  index: ResourceIndex;
  /**
   * Effective thresholds of every rule in this run (enabled or not), keyed by ruleId. Used by rules whose
   * conditions are defined relative to another rule (e.g. mutually exclusive rules); fall back to the other
   * rule's defaults when absent.
   */
  ruleThresholds?: ReadonlyMap<string, ThresholdValues>;
}

export interface DetectedOutcome {
  outcome: 'DETECTED';
  title: string;
  description: string;
  /** Overrides the rule's default severity for this resource. */
  severity?: Severity;
  confidence: ConfidenceLevel;
  riskLevel: RiskLevel;
  evidence: EvidenceItem[];
  suggestedAction: SuggestedAction;
  savingsRequest: SavingsRequest | null;
}

export interface NotDetectedOutcome {
  outcome: 'NOT_DETECTED';
}

export interface NotEvaluatedOutcome {
  outcome: 'NOT_EVALUATED';
  /** Machine-readable reason code, optionally followed by ": detail". */
  reason: string;
}

export type RuleOutcome = DetectedOutcome | NotDetectedOutcome | NotEvaluatedOutcome;

export type ResourceOf<K extends ResourceType> = Extract<NormalizedResource, { resourceType: K }>;

export interface RuleDefinition<K extends ResourceType = ResourceType> {
  /** Stable kebab-case identifier; part of the finding ID, never change once released. */
  ruleId: string;
  name: string;
  description: string;
  resourceType: K;
  category: FindingCategory;
  /** Bump when detection semantics change. */
  version: number;
  defaultSeverity: Severity;
  defaultThresholds: ThresholdValues;
  thresholdDescriptions: Record<string, string>;
  evaluate(resource: ResourceOf<K>, ctx: RuleContext): RuleOutcome;
}

export type AnyRuleDefinition = { [K in ResourceType]: RuleDefinition<K> }[ResourceType];

export function defineRule<K extends ResourceType>(rule: RuleDefinition<K>): RuleDefinition<K> {
  return rule;
}

export const NOT_DETECTED: NotDetectedOutcome = { outcome: 'NOT_DETECTED' };

export function notEvaluated(reason: string): NotEvaluatedOutcome {
  return { outcome: 'NOT_EVALUATED', reason };
}
