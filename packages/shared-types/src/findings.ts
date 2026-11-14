import type {
  ConfidenceLevel,
  FindingCategory,
  FindingStatus,
  RecommendationStatus,
  ResourceType,
  RiskLevel,
  Severity,
  SuggestedActionType,
} from './enums';
import type { SavingsEstimate, SavingsRequest } from './pricing';

export interface EvidenceItem {
  /** Stable machine key, e.g. "cpu.average". */
  key: string;
  label: string;
  value: string | number | boolean | null;
  unit?: string;
  /** Human-readable threshold that was applied, e.g. "< 5". */
  threshold?: string;
}

export type ThresholdValues = Record<string, number>;

export interface SuggestedAction {
  type: SuggestedActionType;
  summary: string;
  /** Ordered, human-executed steps. CloudSentry never performs these actions in the MVP. */
  steps: string[];
}

/** Outcome of evaluating one rule against one resource. */
export type RuleEvaluationOutcome = 'DETECTED' | 'NOT_DETECTED' | 'NOT_EVALUATED';

export interface RuleEvaluation {
  ruleId: string;
  resourceKey: string;
  resourceType: ResourceType;
  accountId: string;
  region: string;
  resourceId: string;
  outcome: RuleEvaluationOutcome;
  /** Explains NOT_EVALUATED outcomes (insufficient metrics, excluded by tag, ...). */
  reason?: string;
}

/** Output of a detection rule for a resource where an issue was detected. */
export interface DetectedIssue {
  /** Deterministic: hash(accountId, region, ruleId, resourceId). */
  findingId: string;
  ruleId: string;
  ruleName: string;
  ruleVersion: number;
  category: FindingCategory;
  resourceType: ResourceType;
  resourceKey: string;
  accountId: string;
  region: string;
  resourceId: string;
  resourceName: string | null;
  title: string;
  description: string;
  /** Severity before savings-based escalation. */
  baseSeverity: Severity;
  confidence: ConfidenceLevel;
  riskLevel: RiskLevel;
  evidence: EvidenceItem[];
  thresholds: ThresholdValues;
  suggestedAction: SuggestedAction;
  savingsRequest: SavingsRequest | null;
}

/** Output of the detection step (artifact findings.json). */
export interface DetectionResult {
  issues: DetectedIssue[];
  /** One entry per (applicable rule, resource). Used to resolve findings that are no longer detected. */
  evaluations: RuleEvaluation[];
  rulesExecuted: { ruleId: string; ruleVersion: number; enabled: boolean; thresholds: ThresholdValues }[];
}

/** Output of GenerateRecommendations (artifact recommendations.json): one draft per detected issue. */
export interface RecommendationDraft {
  recommendationId: string;
  findingId: string;
  issue: DetectedIssue;
  title: string;
  description: string;
  suggestedAction: SuggestedAction;
  confidence: ConfidenceLevel;
  riskLevel: RiskLevel;
}

/** Output of EstimateSavings (artifact recommendations-priced.json). */
export interface PricedRecommendationDraft extends RecommendationDraft {
  /** max(issue.baseSeverity, severity implied by estimated monthly savings). */
  severity: Severity;
  savings: SavingsEstimate;
}

export interface FindingRecord {
  findingId: string;
  tenantId: string;
  accountId: string;
  region: string;
  resourceType: ResourceType;
  resourceKey: string;
  resourceId: string;
  resourceName: string | null;
  ruleId: string;
  ruleName: string;
  ruleVersion: number;
  category: FindingCategory;
  title: string;
  description: string;
  severity: Severity;
  confidence: ConfidenceLevel;
  status: FindingStatus;
  evidence: EvidenceItem[];
  thresholds: ThresholdValues;
  estimatedMonthlySavings: number | null;
  savingsEstimateType: 'POINT' | 'UPPER_BOUND' | null;
  currency: 'USD';
  firstDetectedAt: string;
  lastDetectedAt: string;
  lastEvaluatedAt: string;
  occurrenceCount: number;
  /** Number of times the finding re-opened after being resolved. */
  reopenCount: number;
  resolvedAt: string | null;
  resolutionReason: 'NOT_DETECTED' | 'RESOURCE_NOT_FOUND' | null;
  lastScanId: string;
  statusNote: string | null;
  statusUpdatedBy: string | null;
  statusUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface StatusChange<S extends string> {
  status: S;
  at: string;
  by: string;
  note: string | null;
}

export interface RecommendationRecord {
  recommendationId: string;
  findingId: string;
  tenantId: string;
  accountId: string;
  region: string;
  resourceType: ResourceType;
  resourceKey: string;
  resourceId: string;
  resourceName: string | null;
  ruleId: string;
  title: string;
  description: string;
  evidence: EvidenceItem[];
  suggestedAction: SuggestedAction;
  savings: SavingsEstimate;
  estimatedMonthlySavings: number | null;
  estimatedAnnualSavings: number | null;
  currency: 'USD';
  confidence: ConfidenceLevel;
  riskLevel: RiskLevel;
  severity: Severity;
  status: RecommendationStatus;
  statusNote: string | null;
  /** Most recent status changes, newest first (capped). */
  statusHistory: StatusChange<RecommendationStatus>[];
  /**
   * Estimated monthly savings recorded when an ACCEPTED recommendation's underlying issue
   * disappeared. This is an estimate based on pre-change pricing, not a billing measurement.
   */
  realizedMonthlySavingsEstimate: number | null;
  resolvedAt: string | null;
  lastScanId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
