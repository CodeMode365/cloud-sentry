import type { EvidenceItem } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import {
  assessCapacityMode,
  averageUtilizationPercent,
  CAPACITY_MODE_DEFAULTS,
  DYNAMODB_CAPACITY_MODE_RULE_ID,
  peakToAverage,
  perSecond,
  readCapacityProfile,
  tableEvidence,
  tableStateGate,
} from './dynamodb-shared';
import {
  coverageEvidence,
  normalizeTo30Days,
  observationEvidence,
  pct,
  requireObservation,
} from './metric-helpers';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

type Thresholds = Record<keyof typeof CAPACITY_MODE_DEFAULTS, number>;

export const dynamoDbCapacityModeRule = defineRule({
  ruleId: DYNAMODB_CAPACITY_MODE_RULE_ID,
  name: 'DynamoDB table suited to on-demand capacity',
  description:
    'Provisioned-mode DynamoDB table with low average utilization on every provisioned side and spiky ' +
    'traffic (busiest hour far above the average). On-demand capacity bills per request and needs no peak ' +
    'provisioning. The savings engine reports savings as unavailable when on-demand is not cheaper at the ' +
    'observed traffic.',
  resourceType: 'DYNAMODB_TABLE',
  category: 'OVERPROVISIONED',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: CAPACITY_MODE_DEFAULTS,
  thresholdDescriptions: {
    maxAverageUtilizationPercent:
      'Average consumed units per second must be below this share of provisioned capacity on every side with provisioned capacity (percent).',
    minPeakToAverage:
      'Busiest-hour units per second divided by the average must be at least this ratio on at least one side (ratio).',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage: 'Minimum fraction (0-1) of expected hourly datapoints that must be present for each metric.',
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const gate = tableStateGate(resource);
    if (gate) return gate;
    const a = resource.attributes;
    if (a.billingMode !== 'PROVISIONED') return NOT_DETECTED;

    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);
    const profile = readCapacityProfile(resource, t.minCoverage);
    if (!profile.ok) return notEvaluated(profile.reason);
    const assessment = assessCapacityMode(profile.sides, t);
    if (!assessment.met) return NOT_DETECTED;

    const [read, write] = profile.sides;
    const monthlyReadUnits = round(normalizeTo30Days(read.consumedTotal, obs.observableDays), 0);
    const monthlyWriteUnits = round(normalizeTo30Days(write.consumedTotal, obs.observableDays), 0);
    const evidence: EvidenceItem[] = [];
    for (const side of profile.sides) {
      const util = averageUtilizationPercent(side);
      const ratio = peakToAverage(side);
      evidence.push(
        {
          key: `${side.side}.provisioned`,
          label: `Provisioned ${side.unit}`,
          value: side.provisioned,
          unit: side.unit,
        },
        {
          key: `${side.side}.averageUtilization`,
          label: `${side.label} average utilization`,
          value: util === null ? null : pct(util),
          unit: '%',
          threshold: side.provisioned > 0 ? `< ${t.maxAverageUtilizationPercent}` : 'ignored (0 provisioned)',
        },
        {
          key: `${side.side}.averagePerSecond`,
          label: `${side.label} average consumption`,
          value: perSecond(side.averagePerSecond),
          unit: `${side.unit}/s`,
        },
        {
          key: `${side.side}.peakToAverage`,
          label: `${side.label} busiest hour / average`,
          value: ratio === null ? null : round(ratio, 2),
          threshold: `>= ${t.minPeakToAverage} (at least one side)`,
        },
      );
    }
    evidence.push(
      {
        key: 'read.monthlyUnits',
        label: 'Read units per month (normalised to 30 days)',
        value: monthlyReadUnits,
      },
      {
        key: 'write.monthlyUnits',
        label: 'Write units per month (normalised to 30 days)',
        value: monthlyWriteUnits,
      },
      observationEvidence(obs.observableDays, t.minObservationDays),
      coverageEvidence(Math.min(read.coverage, write.coverage), t.minCoverage),
      ...tableEvidence(resource),
    );
    if (a.autoScalingEnabled) {
      evidence.push({
        key: 'table.autoScalingNote',
        label: 'Auto scaling',
        value:
          'Auto scaling is enabled; utilization is measured against the provisioned capacity at discovery time, which may vary.',
      });
    }

    const label = resource.name ?? a.tableName;
    const spikyLabels = assessment.spiky.map((s) => s.label.toLowerCase()).join(' and ');
    return {
      outcome: 'DETECTED',
      title: `DynamoDB table ${label} may be cheaper in on-demand mode`,
      description:
        `Table ${a.tableName} is provisioned with ${read.provisioned} RCU and ${write.provisioned} WCU, but averaged ` +
        `${assessment.considered.map((s) => `${pct(averageUtilizationPercent(s) ?? 0)}% ${s.label.toLowerCase()} utilization`).join(' and ')} ` +
        `over ${round(obs.observableDays, 0)} days with spiky ${spikyLabels} traffic. Provisioned capacity must cover the peaks, ` +
        'so most of it sits unused; on-demand mode bills per request instead.',
      confidence: 'MEDIUM',
      riskLevel: 'LOW',
      evidence,
      suggestedAction: {
        type: 'SWITCH_CAPACITY_MODE',
        summary:
          'Compare the on-demand cost at observed traffic with the current provisioned cost, then consider switching to on-demand.',
        steps: [
          'Review the savings estimate: on-demand is only cheaper while average utilization stays low (roughly below 29% at us-east-1 prices).',
          'Check expected traffic growth; on-demand cost grows with every request.',
          'Switch the table to on-demand (PAY_PER_REQUEST) through your infrastructure-as-code. Capacity mode changes are limited per 24 hours, and global secondary indexes switch with the table.',
          'Compare the DynamoDB bill for the following weeks with the previous provisioned cost.',
        ],
      },
      savingsRequest: {
        kind: 'DYNAMODB_SWITCH_TO_ON_DEMAND',
        region: resource.region,
        tableClass: a.tableClass,
        provisionedRcu: read.provisioned,
        provisionedWcu: write.provisioned,
        monthlyReadUnits,
        monthlyWriteUnits,
      },
    };
  },
});
