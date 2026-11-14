import type { AccountOnboardingInstructions, CloudAccount } from './accounts';
import type { CloudResource } from './resources';
import type { FindingRecord, RecommendationRecord } from './findings';
import type { ScanExecution } from './scans';
import type { FindingCategory, ResourceType, Severity } from './enums';
/** Response envelopes for the /api/v1 REST API. */

export interface ApiItemResponse<T> {
  data: T;
}

export interface ApiListResponse<T> {
  data: T[];
  /** Opaque cursor; pass as `cursor` to fetch the next page. null when there are no more pages. */
  nextCursor: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PRECONDITION_FAILED',
  'THROTTLED',
  'UPSTREAM_ERROR',
  'NOT_IMPLEMENTED',
  'INTERNAL_ERROR',
  'AUTH_CHALLENGE_UNSUPPORTED',
  'USER_NOT_CONFIRMED',
  'INVALID_CREDENTIALS',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

// ---------- Endpoint response payloads (the `data` field) ----------

/** POST /accounts */
export interface CreateAccountResponse {
  account: CloudAccount;
  onboarding: AccountOnboardingInstructions;
}

/** GET /scans/:scanId/results */
export interface ScanResultsResponse {
  scan: ScanExecution;
  /** Findings whose most recent detection happened in this scan. */
  findings: FindingRecord[];
  recommendations: RecommendationRecord[];
}

/** GET /resources/:resourceKey */
export interface ResourceDetailResponse {
  resource: CloudResource;
  findings: FindingRecord[];
  recommendations: RecommendationRecord[];
}

/** GET /reports/:reportId/download */
export interface DownloadUrlResponse {
  url: string;
  expiresAt: string;
}

/** GET /rules: detection rule catalog entry. */
export interface RuleDefinitionSummary {
  ruleId: string;
  name: string;
  description: string;
  resourceType: ResourceType;
  category: FindingCategory;
  version: number;
  defaultSeverity: Severity;
  defaultThresholds: Record<string, number>;
  /** Human-readable explanation per threshold key, including units. */
  thresholdDescriptions: Record<string, string>;
}
