import type { EvidenceItem, ThresholdValues } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { readMetrics } from './metric-helpers';
import {
  NOT_DETECTED,
  notEvaluated,
  type NotDetectedOutcome,
  type NotEvaluatedOutcome,
  type ResourceOf,
} from './types';

export type DynamoDbTable = ResourceOf<'DYNAMODB_TABLE'>;

export const DYNAMODB_CAPACITY_MODE_RULE_ID = 'dynamodb-capacity-mode';

/** Defaults of `dynamodb-capacity-mode`; also used by `dynamodb-overprovisioned-capacity` for mutual exclusion. */
export const CAPACITY_MODE_DEFAULTS = {
  maxAverageUtilizationPercent: 15,
  minPeakToAverage: 4,
  minObservationDays: 14,
  minCoverage: 0.8,
};

/**
 * ACTIVE tables are evaluated; DELETING is NOT_DETECTED; other states are transient. When DescribeTable
 * failed, discovery records state "unknown" and billing mode / table class "UNKNOWN": NOT_EVALUATED.
 */
export function tableStateGate(resource: DynamoDbTable): NotDetectedOutcome | NotEvaluatedOutcome | null {
  const a = resource.attributes;
  if (resource.state === 'unknown' || a.billingMode === 'UNKNOWN' || a.tableClass === 'UNKNOWN') {
    return notEvaluated('TABLE_DETAILS_UNAVAILABLE: DescribeTable failed during discovery');
  }
  if (resource.state === 'ACTIVE') return null;
  if (resource.state === 'DELETING') return NOT_DETECTED;
  return notEvaluated(`TRANSIENT_STATE: ${resource.state}`);
}

/**
 * One side (reads or writes) of a table's throughput. CloudWatch hourly Sum datapoints are converted to
 * units per second (Sum / period). `peakPerSecond` is the busiest hour's average rate: bursts shorter than an
 * hour are invisible at this granularity.
 */
export interface CapacitySide {
  side: 'read' | 'write';
  label: 'Read' | 'Write';
  unit: 'RCU' | 'WCU';
  provisioned: number;
  consumedTotal: number;
  averagePerSecond: number;
  p95PerSecond: number;
  peakPerSecond: number;
  coverage: number;
}

export function readCapacityProfile(
  resource: DynamoDbTable,
  minCoverage: number,
): { ok: true; sides: [CapacitySide, CapacitySide] } | { ok: false; reason: string } {
  const reads = readMetrics(
    resource,
    { read: ['ConsumedReadCapacityUnits', 'Sum'], write: ['ConsumedWriteCapacityUnits', 'Sum'] },
    minCoverage,
  );
  if (!reads.ok) return reads;
  const a = resource.attributes;
  const build = (side: 'read' | 'write'): CapacitySide | null => {
    const { series, stats } = reads.values[side];
    if (stats.average === null || stats.p95 === null || stats.maximum === null || stats.sum === null)
      return null;
    const period = series.periodSeconds;
    return {
      side,
      label: side === 'read' ? 'Read' : 'Write',
      unit: side === 'read' ? 'RCU' : 'WCU',
      provisioned: (side === 'read' ? a.provisionedReadCapacityUnits : a.provisionedWriteCapacityUnits) ?? 0,
      consumedTotal: stats.sum,
      averagePerSecond: stats.average / period,
      p95PerSecond: stats.p95 / period,
      peakPerSecond: stats.maximum / period,
      coverage: stats.coverage,
    };
  };
  const read = build('read');
  const write = build('write');
  if (!read || !write) return { ok: false, reason: 'METRIC_STATISTICS_INCOMPLETE' };
  return { ok: true, sides: [read, write] };
}

export function averageUtilizationPercent(side: CapacitySide): number | null {
  return side.provisioned > 0 ? (side.averagePerSecond / side.provisioned) * 100 : null;
}

export function peakToAverage(side: CapacitySide): number | null {
  return side.averagePerSecond > 0 ? side.peakPerSecond / side.averagePerSecond : null;
}

export interface CapacityModeAssessment {
  met: boolean;
  /** Sides with provisioned capacity > 0 (others are ignored). */
  considered: CapacitySide[];
  spiky: CapacitySide[];
}

/**
 * The `dynamodb-capacity-mode` condition: every side with provisioned capacity averages below
 * `maxAverageUtilizationPercent` AND at least one of them is spiky (peak / average >= `minPeakToAverage`).
 * Pure function of the metric statistics so both DynamoDB capacity rules evaluate it identically.
 */
export function assessCapacityMode(
  sides: readonly CapacitySide[],
  thresholds: Pick<typeof CAPACITY_MODE_DEFAULTS, 'maxAverageUtilizationPercent' | 'minPeakToAverage'>,
): CapacityModeAssessment {
  const considered = sides.filter((s) => s.provisioned > 0);
  const allLow = considered.every(
    (s) => (averageUtilizationPercent(s) ?? 0) < thresholds.maxAverageUtilizationPercent,
  );
  const spiky = considered.filter((s) => {
    const ratio = peakToAverage(s);
    return ratio !== null && ratio >= thresholds.minPeakToAverage;
  });
  return { met: considered.length > 0 && allLow && spiky.length > 0, considered, spiky };
}

/** Effective capacity-mode thresholds for this run (tenant overrides honoured), else its defaults. */
export function capacityModeThresholds(ruleThresholds: ReadonlyMap<string, ThresholdValues> | undefined) {
  return { ...CAPACITY_MODE_DEFAULTS, ...(ruleThresholds?.get(DYNAMODB_CAPACITY_MODE_RULE_ID) ?? {}) };
}

export function tableEvidence(resource: DynamoDbTable): EvidenceItem[] {
  const a = resource.attributes;
  const evidence: EvidenceItem[] = [
    { key: 'table.billingMode', label: 'Capacity mode', value: a.billingMode },
    { key: 'table.class', label: 'Table class', value: a.tableClass },
    {
      key: 'table.autoScaling',
      label: 'Auto scaling',
      value: a.autoScalingEnabled === null ? 'unknown' : a.autoScalingEnabled,
    },
    { key: 'table.sizeGib', label: 'Table size', value: round(a.tableSizeBytes / 1024 ** 3, 3), unit: 'GiB' },
  ];
  if (a.gsiCount > 0) {
    evidence.push({
      key: 'table.gsi',
      label: 'Global secondary indexes (excluded from the estimate)',
      value: `${a.gsiCount} index(es), ${a.gsiProvisionedReadCapacityUnits} RCU / ${a.gsiProvisionedWriteCapacityUnits} WCU provisioned`,
    });
  }
  if (a.replicaRegions.length > 0) {
    evidence.push({
      key: 'table.replicas',
      label: 'Global table replicas',
      value: a.replicaRegions.join(', '),
    });
  }
  return evidence;
}

export function perSecond(value: number): number {
  return round(value, 3);
}
