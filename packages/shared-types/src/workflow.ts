import type { ResourceType, ScanTrigger } from './enums';
import type { DiscoveryTypeResult } from './scans';

/** Input of the scan state machine; also the base of every step's input. Contains no credentials. */
export interface ScanWorkflowInput {
  tenantId: string;
  accountId: string;
  scanId: string;
  trigger: ScanTrigger;
}

export interface ValidateAccountOutput {
  regions: string[];
  lookbackDays: number;
  artifactsPrefix: string;
}

export interface AssumeRoleOutput {
  verified: boolean;
  callerAccountId: string;
  /** Regions to scan after intersecting configured regions with enabled regions. */
  regions: string[];
}

export interface ResolveRegionsOutput {
  regions: string[];
  skippedRegions: { region: string; reason: string }[];
}

export interface DiscoveryWorkerInput extends ScanWorkflowInput {
  regions: string[];
  artifactsPrefix: string;
}

export type DiscoveryWorkerOutput = DiscoveryTypeResult;

export interface StepArtifactOutput {
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  artifactKey: string | null;
  message?: string;
  counts?: Record<string, number>;
}

/** Full state object carried between steps. Every field except the base input is optional. */
export interface ScanWorkflowState extends ScanWorkflowInput {
  validation?: ValidateAccountOutput;
  role?: AssumeRoleOutput;
  regionsResolved?: ResolveRegionsOutput;
  discovery?: DiscoveryWorkerOutput[];
  metrics?: StepArtifactOutput;
  costs?: StepArtifactOutput;
  normalized?: StepArtifactOutput;
  detection?: StepArtifactOutput;
  recommendations?: StepArtifactOutput;
  savings?: StepArtifactOutput;
  persisted?: StepArtifactOutput;
  summary?: StepArtifactOutput;
  notifications?: StepArtifactOutput;
  error?: { Error?: string; Cause?: string };
}

/**
 * S3 artifact layout. Scan artifacts and reports live under separate top-level prefixes so lifecycle
 * rules can retain them for different periods. The tenant ID is always part of the key.
 */
export const SCAN_ARTIFACT_ROOT = 'scans/';
export const REPORT_ROOT = 'reports/';
export const ARTIFACT_KEYS = {
  scanPrefix: (accountId: string, scanId: string, tenantId: string) =>
    `${SCAN_ARTIFACT_ROOT}${tenantId}/${accountId}/${scanId}/`,
  discovery: (prefix: string, type: ResourceType) => `${prefix}discovery/${type}.json`,
  metrics: (prefix: string) => `${prefix}metrics.json`,
  costs: (prefix: string) => `${prefix}costs.json`,
  normalized: (prefix: string) => `${prefix}normalized.json`,
  detection: (prefix: string) => `${prefix}findings.json`,
  recommendations: (prefix: string) => `${prefix}recommendations.json`,
  savings: (prefix: string) => `${prefix}recommendations-priced.json`,
  persisted: (prefix: string) => `${prefix}persisted.json`,
  summary: (prefix: string) => `${prefix}summary.json`,
  report: (tenantId: string, accountScope: string, type: string, reportId: string, ext: string) =>
    `${REPORT_ROOT}${tenantId}/${accountScope}/${type.toLowerCase()}/${reportId}.${ext}`,
} as const;

/** Artifact payloads. Each wraps data with provenance metadata. */
export interface ArtifactEnvelope<T> {
  schemaVersion: 1;
  tenantId: string;
  accountId: string;
  scanId: string;
  createdAt: string;
  data: T;
}

/** Output of PersistResults (artifact persisted.json), consumed by summary and notification steps. */
export interface PersistOutcome {
  resourcesUpserted: number;
  resourcesMarkedNotFound: number;
  findingsDetected: number;
  newFindingIds: string[];
  reopenedFindingIds: string[];
  resolvedFindingIds: string[];
  newRecommendationIds: string[];
  reopenedRecommendationIds: string[];
  openRecommendations: number;
  potentialMonthlySavings: number;
  criticalFindings: number;
}
