import type { ResourceType, Severity } from './enums';
import type { DailyCostPoint, DimensionCost, MonthlyCostPoint } from './costs';
import type { ScanExecution } from './scans';
import type { RecommendationRecord } from './findings';

export interface OverviewAnalytics {
  generatedAt: string;
  accounts: { total: number; connected: number; synthetic: number };
  spend: {
    /** Sum of Cost Explorer month-to-date cost across accounts with cost data (actual billed, may be unfinalized). */
    currentMonthToDate: number | null;
    previousMonth: number | null;
    currency: string;
    accountsWithCostData: number;
    accountsWithoutCostData: number;
    /** True when any included snapshot is SYNTHETIC local-development data (never real billing). */
    syntheticCostIncluded: boolean;
  };
  /** Sum of estimated monthly savings of OPEN/UNDER_REVIEW/ACCEPTED recommendations. Estimate. */
  potentialMonthlySavings: number;
  resources: { total: number; byType: Partial<Record<ResourceType, number>> };
  findings: { active: number; critical: number; bySeverity: Record<Severity, number> };
  recentScans: ScanExecution[];
  costTrend: MonthlyCostPoint[];
  serviceCosts: DimensionCost[];
  topOpportunities: RecommendationRecord[];
}

export interface CostAnalytics {
  accountIds: string[];
  currency: string;
  availability: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  unavailableAccounts: { accountId: string; reason: string | null }[];
  retrievedAt: string | null;
  /** True when any included snapshot is SYNTHETIC local-development data (never real billing). */
  syntheticCostIncluded: boolean;
  monthlyTrend: MonthlyCostPoint[];
  daily: DailyCostPoint[];
  previousMonthDaily: DailyCostPoint[];
  services: DimensionCost[];
  regions: DimensionCost[];
  monthOverMonth: {
    currentMonthToDate: number | null;
    previousMonthToDate: number | null;
    previousMonthTotal: number | null;
    changeAmount: number | null;
    changePercent: number | null;
  };
  estimatedSavings: { potentialMonthly: number; potentialAnnual: number };
  anomalies: { date: string; amount: number; baseline: number; deviationPercent: number }[];
}

export interface ResourceAnalytics {
  total: number;
  byType: { resourceType: ResourceType; count: number }[];
  byRegion: { region: string; count: number }[];
  byAccount: { accountId: string; count: number }[];
  byState: { state: string; count: number }[];
  withFindings: number;
}

export interface SavingsAnalytics {
  currency: 'USD';
  potential: { monthly: number; annual: number; count: number };
  underReview: { monthly: number; count: number };
  accepted: { monthly: number; count: number };
  /** Estimated realized savings: ACCEPTED recommendations whose issue was later resolved. */
  realizedEstimate: { monthly: number; count: number };
  dismissed: { monthly: number; count: number };
  unpricedRecommendations: number;
  byRule: { ruleId: string; monthly: number; count: number }[];
  byResourceType: { resourceType: ResourceType; monthly: number; count: number }[];
  byAccount: { accountId: string; monthly: number; count: number }[];
}
