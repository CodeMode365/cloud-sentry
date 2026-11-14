import type { ResourceType, ScanStatus, ScanTrigger } from './enums';

export const SCAN_STEPS = [
  'ValidateAccount',
  'AssumeCustomerRole',
  'DiscoverResources',
  'CollectCloudWatchMetrics',
  'AnalyzeAWSCosts',
  'NormalizeResourceData',
  'ExecuteDetectionRules',
  'GenerateRecommendations',
  'EstimateSavings',
  'PersistResults',
  'GenerateScanSummary',
  'SendNotifications',
] as const;
export type ScanStepName = (typeof SCAN_STEPS)[number];

export type StepStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';

export interface ScanStepState {
  status: StepStatus;
  startedAt: string | null;
  completedAt: string | null;
  message: string | null;
}

export interface RegionError {
  region: string;
  errorCode: string;
  message: string;
}

export interface DiscoveryTypeResult {
  resourceType: ResourceType;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  resourceCount: number;
  regionsSucceeded: string[];
  regionsFailed: RegionError[];
  artifactKey: string | null;
  durationMs: number;
  errorMessage?: string;
}

export interface ScanError {
  step: ScanStepName | 'Workflow';
  code: string;
  message: string;
  at: string;
  resourceType?: ResourceType;
  region?: string;
}

export interface ScanSummary {
  resourcesDiscovered: number;
  resourcesByType: Partial<Record<ResourceType, number>>;
  findingsDetected: number;
  newFindings: number;
  reopenedFindings: number;
  resolvedFindings: number;
  criticalFindings: number;
  openRecommendations: number;
  /** Sum of estimated monthly savings for issues detected in this scan (estimate, USD). */
  potentialMonthlySavings: number;
  metricsCoverage: { resourcesWithMetrics: number; resourcesWithoutMetrics: number };
  costDataAvailable: boolean;
}

export interface ScanExecution {
  scanId: string;
  tenantId: string;
  accountId: string;
  trigger: ScanTrigger;
  /** User ID for manual scans, schedule ID for scheduled scans. */
  triggeredBy: string;
  status: ScanStatus;
  executionArn: string | null;
  regions: string[];
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  steps: Partial<Record<ScanStepName, ScanStepState>>;
  discovery: DiscoveryTypeResult[];
  summary: ScanSummary | null;
  errors: ScanError[];
  artifactsPrefix: string;
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}
