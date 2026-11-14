import type { EvidenceItem } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import {
  assessCapacityMode,
  capacityModeThresholds,
  type CapacitySide,
  perSecond,
  readCapacityProfile,
  tableEvidence,
  tableStateGate,
} from './dynamodb-shared';
import { coverageEvidence, observationEvidence, pct, readMetric, requireObservation } from './metric-helpers';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { maxUtilizationPercent: 30, headroomFactor: 2, minObservationDays: 14, minCoverage: 0.8 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

interface SideAssessment {
  side: CapacitySide;
  p95UtilizationPercent: number | null;
  recommended: number;
  flagged: boolean;
  throttled: number | null;
}

export const dynamoDbOverprovisionedCapacityRule = defineRule({
  ruleId: 'dynamodb-overprovisioned-capacity',
  name: 'Over-provisioned DynamoDB capacity',
  description:
    'Provisioned-mode DynamoDB table without auto scaling whose read and/or write consumption (p95 of hourly ' +
    'rates) stays far below the provisioned capacity. Mutually exclusive with dynamodb-capacity-mode: tables ' +
    'with low average and spiky traffic are reported there instead. Hourly data hides sub-hour bursts, so ' +
    'recommendations keep headroom over the busiest hour.',
  resourceType: 'DYNAMODB_TABLE',
  category: 'OVERPROVISIONED',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    maxUtilizationPercent:
      'p95 of hourly consumed units per second (ConsumedXCapacityUnits:Sum / 3600) must be below this share of provisioned capacity (percent).',
    headroomFactor:
      'Recommended capacity = ceil(busiest-hour units per second x this factor), minimum 1 (multiplier).',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage: 'Minimum fraction (0-1) of expected hourly datapoints that must be present for each metric.',
  },
  evaluate(resource, { thresholds, ruleThresholds }) {
    const t = thresholds as Thresholds;
    const gate = tableStateGate(resource);
    if (gate) return gate;
    const a = resource.attributes;
    if (a.billingMode !== 'PROVISIONED') return NOT_DETECTED;
    if (a.autoScalingEnabled === null) {
      return notEvaluated('AUTOSCALING_UNKNOWN: Application Auto Scaling targets could not be read');
    }
    if (a.autoScalingEnabled) return NOT_DETECTED;

    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);
    const profile = readCapacityProfile(resource, t.minCoverage);
    if (!profile.ok) return notEvaluated(profile.reason);

    const assessments: SideAssessment[] = profile.sides.map((side) => {
      const throttleRead = readMetric(
        resource,
        side.side === 'read' ? 'ReadThrottleEvents' : 'WriteThrottleEvents',
        'Sum',
        0,
      );
      const throttled = throttleRead.ok ? throttleRead.stats.sum : null;
      if (side.provisioned <= 0) {
        return {
          side,
          p95UtilizationPercent: null,
          recommended: side.provisioned,
          flagged: false,
          throttled,
        };
      }
      const p95UtilizationPercent = (side.p95PerSecond / side.provisioned) * 100;
      const recommended = Math.max(1, Math.ceil(round(side.peakPerSecond * t.headroomFactor, 6)));
      const flagged =
        p95UtilizationPercent < t.maxUtilizationPercent &&
        recommended < side.provisioned &&
        // Throttling shows that bursts already exceed capacity, whatever the hourly averages say.
        !(throttled !== null && throttled > 0);
      return {
        side,
        p95UtilizationPercent,
        recommended: flagged ? recommended : side.provisioned,
        flagged,
        throttled,
      };
    });
    if (!assessments.some((s) => s.flagged)) return NOT_DETECTED;

    // Mutual exclusion: tables meeting the capacity-mode condition are reported by dynamodb-capacity-mode.
    if (assessCapacityMode(profile.sides, capacityModeThresholds(ruleThresholds)).met) return NOT_DETECTED;

    const [read, write] = assessments as [SideAssessment, SideAssessment];
    const evidence: EvidenceItem[] = [];
    for (const s of assessments) {
      evidence.push(
        {
          key: `${s.side.side}.provisioned`,
          label: `Provisioned ${s.side.unit}`,
          value: s.side.provisioned,
          unit: s.side.unit,
        },
        {
          key: `${s.side.side}.p95Utilization`,
          label: `${s.side.label} p95 utilization (hourly average per second)`,
          value: s.p95UtilizationPercent === null ? null : pct(s.p95UtilizationPercent),
          unit: '%',
          threshold: `< ${t.maxUtilizationPercent}`,
        },
        {
          key: `${s.side.side}.peakPerSecond`,
          label: `${s.side.label} busiest-hour average`,
          value: perSecond(s.side.peakPerSecond),
          unit: `${s.side.unit}/s`,
        },
        {
          key: `${s.side.side}.recommended`,
          label: `Recommended ${s.side.unit}`,
          value: s.recommended,
          unit: s.side.unit,
          threshold: s.flagged ? `ceil(peak x ${t.headroomFactor})` : 'unchanged',
        },
      );
      if (s.throttled !== null && s.throttled > 0) {
        evidence.push({
          key: `${s.side.side}.throttleEvents`,
          label: `${s.side.label} throttle events (capacity kept)`,
          value: round(s.throttled, 0),
        });
      }
    }
    evidence.push(
      observationEvidence(obs.observableDays, t.minObservationDays),
      coverageEvidence(Math.min(read.side.coverage, write.side.coverage), t.minCoverage),
      {
        key: 'granularity.note',
        label: 'Granularity',
        value:
          'Hourly CloudWatch sums hide bursts shorter than an hour; the recommendation keeps headroom over the busiest hour.',
      },
      ...tableEvidence(resource),
    );

    const flaggedSides = assessments.filter((s) => s.flagged);
    const changes = flaggedSides
      .map((s) => `${s.side.unit} ${s.side.provisioned} -> ${s.recommended}`)
      .join(', ');
    const label = resource.name ?? a.tableName;
    return {
      outcome: 'DETECTED',
      title: `Over-provisioned capacity on DynamoDB table ${label}`,
      description:
        `Table ${a.tableName} is provisioned with ${read.side.provisioned} RCU and ${write.side.provisioned} WCU without ` +
        `auto scaling, but ${flaggedSides.map((s) => `${s.side.label.toLowerCase()}s peaked at ${perSecond(s.side.peakPerSecond)} ${s.side.unit}/s (p95 ${pct(s.p95UtilizationPercent ?? 0)}% of provisioned)`).join(' and ')} ` +
        `over ${round(obs.observableDays, 0)} days. Suggested: ${changes}.`,
      confidence: 'MEDIUM',
      riskLevel: 'MEDIUM',
      evidence,
      suggestedAction: {
        type: 'RIGHTSIZE_TABLE_CAPACITY',
        summary: `Consider lowering provisioned capacity (${changes}) or enabling auto scaling.`,
        steps: [
          'Check for traffic peaks outside the observation window (batch imports, month-end jobs, backfills) and for short bursts hidden by hourly data.',
          'Prefer enabling DynamoDB auto scaling with a target utilization over a fixed lower value.',
          'Lower provisioned capacity through your infrastructure-as-code; DynamoDB limits how many decreases can be made per day.',
          'Monitor ReadThrottleEvents and WriteThrottleEvents after the change and raise capacity if throttling appears.',
        ],
      },
      savingsRequest: {
        kind: 'DYNAMODB_RIGHTSIZE_PROVISIONED',
        region: resource.region,
        tableClass: a.tableClass,
        currentRcu: read.side.provisioned,
        currentWcu: write.side.provisioned,
        recommendedRcu: read.recommended,
        recommendedWcu: write.recommended,
      },
    };
  },
});
