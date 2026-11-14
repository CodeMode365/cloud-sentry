/**
 * Cost data retrieved from AWS Cost Explorer. These values are ACTUAL billed (or, for the current
 * open billing period, unfinalized) costs as reported by AWS - never estimates produced by CloudSentry.
 */

export type CostAvailability = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';

export interface CostAmount {
  amount: number;
  /** Cost Explorer marks costs for open periods as Estimated (not yet finalized by AWS billing). */
  unfinalized: boolean;
}

export interface MonthlyCostPoint extends CostAmount {
  /** YYYY-MM */
  month: string;
}

export interface DailyCostPoint extends CostAmount {
  /** YYYY-MM-DD */
  date: string;
}

export interface DimensionCost {
  key: string;
  amount: number;
}

export interface ResourceLevelCost {
  resourceId: string;
  service: string;
  amount: number;
}

export interface CostSnapshot {
  tenantId: string;
  accountId: string;
  currency: string;
  /** SYNTHETIC only for local-development seed data (never produced by a scan). */
  source: 'AWS_COST_EXPLORER' | 'SYNTHETIC';
  /** Cost Explorer metric used, e.g. UnblendedCost. */
  costMetric: string;
  availability: CostAvailability;
  unavailableReason: string | null;
  retrievedAt: string;
  scanId: string | null;
  currentMonth: (CostAmount & { start: string; end: string }) | null;
  previousMonth: (CostAmount & { start: string; end: string }) | null;
  /** Same day-range of previous month for fair month-to-date comparison. */
  previousMonthToDate: CostAmount | null;
  monthlyTrend: MonthlyCostPoint[];
  daily: DailyCostPoint[];
  services: DimensionCost[];
  regions: DimensionCost[];
  resourceLevel: {
    availability: CostAvailability;
    reason: string | null;
    items: ResourceLevelCost[];
  };
  errors: { query: string; code: string; message: string }[];
}
