import type { ConfidenceLevel, EvidenceItem } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { tableEvidence, tableStateGate } from './dynamodb-shared';
import {
  ageEvidence,
  BYTES_PER_GIB,
  coverageConfidence,
  coverageEvidence,
  insufficientCoverageReason,
  observationEvidence,
  readMetric,
  requireObservation,
  resourceAge,
} from './metric-helpers';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { minAgeDays: 30, minObservationDays: 14, minCoverage: 0.8 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

const CONSUMED = ['ConsumedReadCapacityUnits', 'ConsumedWriteCapacityUnits'] as const;

export const unusedDynamoDbTableRule = defineRule({
  ruleId: 'unused-dynamodb-table',
  name: 'Unused DynamoDB table',
  description:
    'Active DynamoDB table with no consumed read or write capacity for the whole observation period. ' +
    'Storage (and provisioned capacity, if any) is billed regardless. Missing metrics are never treated as ' +
    'zero traffic.',
  resourceType: 'DYNAMODB_TABLE',
  category: 'UNUSED',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    minAgeDays: 'Tables younger than this (days since creation) are not flagged.',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage:
      'Minimum fraction (0-1) of expected hourly datapoints required to conclude there was no traffic (observed traffic resolves the check regardless of coverage).',
  },
  evaluate(resource, { thresholds, now }) {
    const t = thresholds as Thresholds;
    const gate = tableStateGate(resource);
    if (gate) return gate;
    const a = resource.attributes;
    const age = resourceAge(resource, now);
    if (age === null) return notEvaluated('CREATION_TIME_UNKNOWN');
    if (age.days < t.minAgeDays) return NOT_DETECTED;
    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);

    const reads = CONSUMED.map((metric) => ({ metric, read: readMetric(resource, metric, 'Sum', 0) }));
    for (const { read } of reads) {
      if (read.ok && read.stats.sum !== null && read.stats.sum > 0) return NOT_DETECTED;
    }
    let coverage = 1;
    for (const { metric, read } of reads) {
      if (!read.ok) return notEvaluated(read.reason);
      if (read.stats.sum === null) return notEvaluated(`METRIC_STATISTICS_INCOMPLETE: ${metric}:Sum`);
      if (read.stats.coverage < t.minCoverage) {
        return notEvaluated(insufficientCoverageReason(`${metric}:Sum`, read.stats.coverage, t.minCoverage));
      }
      coverage = Math.min(coverage, read.stats.coverage);
    }

    const provisioned = a.billingMode === 'PROVISIONED';
    const rcu = provisioned ? (a.provisionedReadCapacityUnits ?? 0) : 0;
    const wcu = provisioned ? (a.provisionedWriteCapacityUnits ?? 0) : 0;
    const storageGb = round(a.tableSizeBytes / BYTES_PER_GIB, 3);
    let confidence: ConfidenceLevel = coverageConfidence(coverage, obs.observableDays);
    if (a.replicaRegions.length > 0) confidence = 'MEDIUM';

    const evidence: EvidenceItem[] = [
      { key: 'read.consumedTotal', label: 'Consumed read capacity units', value: 0, threshold: '= 0' },
      { key: 'write.consumedTotal', label: 'Consumed write capacity units', value: 0, threshold: '= 0' },
      ageEvidence('table.ageDays', age, t.minAgeDays),
      { key: 'table.itemCount', label: 'Items (approximate)', value: a.itemCount },
      { key: 'table.deletionProtection', label: 'Deletion protection', value: a.deletionProtectionEnabled },
      observationEvidence(obs.observableDays, t.minObservationDays),
      coverageEvidence(coverage, t.minCoverage),
      ...tableEvidence(resource),
    ];
    if (a.deletionProtectionEnabled) {
      evidence.push({
        key: 'table.deletionProtectionNote',
        label: 'Deletion protection',
        value:
          'Deletion protection is enabled, which often marks a table someone intended to keep; confirm before disabling it.',
      });
    }
    if (a.replicaRegions.length > 0) {
      evidence.push({
        key: 'table.replicasNote',
        label: 'Global table',
        value: 'This is a global table replica; traffic in other regions is not included here.',
      });
    }

    const label = resource.name ?? a.tableName;
    return {
      outcome: 'DETECTED',
      title: `Unused DynamoDB table ${label}`,
      description:
        `Table ${a.tableName} (${storageGb} GiB, about ${a.itemCount} items) consumed no read or write capacity over ` +
        `${round(obs.observableDays, 0)} days` +
        (provisioned ? ` while ${rcu} RCU and ${wcu} WCU stayed provisioned.` : '.') +
        (a.deletionProtectionEnabled ? ' Deletion protection is enabled.' : ''),
      confidence,
      riskLevel: 'HIGH',
      evidence,
      suggestedAction: {
        type: 'DELETE_TABLE',
        summary: 'Confirm no application uses the table, export or back it up, then delete it.',
        steps: [
          'Identify the owner from tags and search application configuration for the table name, including infrequent jobs and other regions.',
          'Export the table to S3 or create an on-demand backup so the data can be restored.',
          a.deletionProtectionEnabled
            ? 'Disable deletion protection only after the owner confirms, then delete the table.'
            : 'Delete the table (and any streams, alarms or auto scaling policies that reference it).',
        ],
      },
      savingsRequest: {
        kind: 'DYNAMODB_DELETE_TABLE',
        region: resource.region,
        tableClass: a.tableClass,
        billingMode: a.billingMode,
        provisionedRcu: rcu,
        provisionedWcu: wcu,
        storageGb,
      },
    };
  },
});
