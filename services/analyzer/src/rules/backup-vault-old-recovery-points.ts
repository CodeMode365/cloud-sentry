import { BACKUP_AGE_BUCKETS_DAYS, type EvidenceItem } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { truncatedListingReason, vaultListingGate } from './backup-shared';
import { BYTES_PER_GIB } from './metric-helpers';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { maxRetentionDays: 365 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

/** AWS Backup resource types whose recovery points are EBS snapshots (priced with EBS snapshot storage). */
const EBS_BACKED_TYPES = new Set(['EBS', 'EC2']);

/**
 * Vault summaries only keep recovery points in age buckets, so the threshold snaps UP to the next bucket
 * boundary (e.g. 400 -> 730): points between the threshold and that boundary are not counted, which keeps
 * the finding conservative. Thresholds above the last boundary cannot be evaluated.
 */
export function snapToAgeBucket(maxRetentionDays: number): number | null {
  return BACKUP_AGE_BUCKETS_DAYS.find((b) => b >= maxRetentionDays) ?? null;
}

export const backupVaultOldRecoveryPointsRule = defineRule({
  ruleId: 'backup-vault-old-recovery-points',
  name: 'AWS Backup vault with old recovery points',
  description:
    'Backup vault holding recovery points older than the retention threshold. Backups are often mandatory, ' +
    'so confidence is LOW and risk HIGH. Only EBS/EC2 recovery points can be priced.',
  resourceType: 'BACKUP_VAULT',
  category: 'RETENTION',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    maxRetentionDays: `Recovery points at least this old are flagged (days). Snapped up to the next age bucket boundary (${BACKUP_AGE_BUCKETS_DAYS.join(', ')}).`,
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const gate = vaultListingGate(resource);
    if (gate) return gate;
    const a = resource.attributes;
    const boundary = snapToAgeBucket(t.maxRetentionDays);
    if (boundary === null) {
      return notEvaluated(
        `THRESHOLD_BEYOND_AGE_BUCKETS: ${t.maxRetentionDays} days exceeds the last age bucket (${BACKUP_AGE_BUCKETS_DAYS.at(-1)} days)`,
      );
    }

    let ebsBytes = 0;
    let otherBytes = 0;
    let count = 0;
    const byType: { resourceType: string; count: number; bytes: number }[] = [];
    for (const summary of a.byResourceType) {
      const old = summary.byAge.filter((b) => b.minDays >= boundary);
      const bytes = old.reduce((s, b) => s + Math.max(0, b.bytes), 0);
      const points = old.reduce((s, b) => s + Math.max(0, b.count), 0);
      if (bytes <= 0 && points <= 0) continue;
      count += points;
      if (EBS_BACKED_TYPES.has(summary.resourceType.toUpperCase())) ebsBytes += bytes;
      else otherBytes += bytes;
      byType.push({ resourceType: summary.resourceType, count: points, bytes });
    }
    const totalBytes = ebsBytes + otherBytes;
    if (totalBytes <= 0) return a.truncated ? notEvaluated(truncatedListingReason(resource)) : NOT_DETECTED;
    const atLeast = a.truncated ? 'at least ' : '';

    const ebsGb = round(ebsBytes / BYTES_PER_GIB, 3);
    const otherGb = round(otherBytes / BYTES_PER_GIB, 3);
    const evidence: EvidenceItem[] = [
      {
        key: 'recoveryPoints.oldGib',
        label: `Recovery point storage at least ${boundary} days old${a.truncated ? ' (at least; listing truncated)' : ''}`,
        value: round(totalBytes / BYTES_PER_GIB, 3),
        unit: 'GiB',
        threshold: `> 0 (age >= ${boundary} days)`,
      },
      {
        key: 'recoveryPoints.oldCount',
        label: `Old recovery points${a.truncated ? ' (at least)' : ''}`,
        value: count,
      },
      ...byType
        .sort((x, y) => x.resourceType.localeCompare(y.resourceType))
        .map((r) => ({
          key: `recoveryPoints.old.${r.resourceType}`,
          label: `${r.resourceType} recovery points at least ${boundary} days old (${r.count})`,
          value: round(r.bytes / BYTES_PER_GIB, 3),
          unit: 'GiB',
        })),
      { key: 'recoveryPoints.ebsGib', label: 'EBS/EC2 storage (priced)', value: ebsGb, unit: 'GiB' },
      { key: 'recoveryPoints.otherGib', label: 'Other storage (not priced)', value: otherGb, unit: 'GiB' },
      { key: 'vault.recoveryPoints', label: 'Recovery points in vault', value: a.recoveryPointCount },
      { key: 'vault.oldest', label: 'Oldest recovery point', value: a.oldestRecoveryPointAt ?? 'unknown' },
      { key: 'vault.locked', label: 'Vault Lock', value: a.locked },
    ];
    if (boundary !== t.maxRetentionDays) {
      evidence.push({
        key: 'threshold.snapped',
        label: 'Threshold snapping',
        value: `Configured ${t.maxRetentionDays} days was snapped up to the ${boundary}-day age bucket boundary; younger points are not counted.`,
      });
    }
    if (a.truncated) {
      evidence.push({
        key: 'vault.truncated',
        label: 'Partial listing',
        value:
          'Discovery stopped at its recovery point cap; totals cover only the listed points, so actual old storage is at least the figures shown.',
      });
    }
    if (a.locked) {
      evidence.push({
        key: 'vault.lockNote',
        label: 'Vault Lock',
        value: 'Vault Lock may prevent deleting recovery points before their minimum retention.',
      });
    }

    const label = resource.name ?? a.vaultName;
    return {
      outcome: 'DETECTED',
      title: `Backup vault ${label} holds recovery points older than ${boundary} days`,
      description:
        `Vault ${a.vaultName} holds ${atLeast}${count} recovery point(s) totalling ${atLeast}${round(totalBytes / BYTES_PER_GIB, 1)} GiB that are at ` +
        `least ${boundary} days old. Backups are often mandatory; review them against your retention policy before deleting any.`,
      confidence: 'LOW',
      riskLevel: 'HIGH',
      evidence,
      suggestedAction: {
        type: 'REDUCE_BACKUP_RETENTION',
        summary:
          'Review old recovery points against your retention policy and expire those that are no longer required.',
        steps: [
          'Confirm legal, regulatory and business retention requirements (and legal holds) for the protected resources.',
          'Identify which backup plans created the old recovery points and fix their lifecycle so future points expire on time.',
          'Delete recovery points that are no longer required, or set their lifecycle to expire; deletion cannot be undone.',
        ],
      },
      savingsRequest: {
        kind: 'BACKUP_RETENTION_REDUCE',
        region: resource.region,
        ebsGbBeyondRetention: ebsGb,
        otherGbBeyondRetention: otherGb,
      },
    };
  },
});
