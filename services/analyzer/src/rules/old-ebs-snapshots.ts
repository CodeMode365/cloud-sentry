import type { ConfidenceLevel, EvidenceItem, SavingsRequest } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { ageInDays } from './metric-helpers';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { retentionDays: 180 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const oldEbsSnapshotsRule = defineRule({
  ruleId: 'old-ebs-snapshots',
  name: 'Old EBS snapshot',
  description:
    'Completed EBS snapshot older than the retention threshold that is not managed by AWS Backup, Data ' +
    'Lifecycle Manager, or an AMI. Old snapshots are not assumed to be unnecessary: review is required.',
  resourceType: 'EBS_SNAPSHOT',
  category: 'RETENTION',
  version: 1,
  defaultSeverity: 'LOW',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    retentionDays: 'Snapshots older than this many days are flagged for retention review.',
  },
  evaluate(resource, { thresholds, now }) {
    const t = thresholds as Thresholds;
    const a = resource.attributes;
    if (resource.state !== 'completed') return notEvaluated(`SNAPSHOT_NOT_COMPLETED: ${resource.state}`);
    if ('aws:backup:source-resource' in resource.tags || /AWS Backup/i.test(a.description ?? '')) {
      return notEvaluated('MANAGED_BY_AWS_BACKUP: retention is governed by the backup plan');
    }
    if ('aws:dlm:lifecycle-policy-id' in resource.tags) {
      return notEvaluated('MANAGED_BY_DLM: retention is governed by a Data Lifecycle Manager policy');
    }
    if (/Created by CreateImage/i.test(a.description ?? '')) {
      return notEvaluated('AMI_BACKING_SNAPSHOT: deregister the AMI before reviewing this snapshot');
    }
    const age = ageInDays(resource.createdAt, now);
    if (age === null) return notEvaluated('CREATION_TIME_UNKNOWN');
    if (age <= t.retentionDays) return NOT_DETECTED;

    const sourceGone = a.sourceVolumeExists === false;
    const confidence: ConfidenceLevel = sourceGone && age > 2 * t.retentionDays ? 'MEDIUM' : 'LOW';
    const evidence: EvidenceItem[] = [
      {
        key: 'snapshot.ageDays',
        label: 'Age',
        value: round(age, 0),
        unit: 'days',
        threshold: `> ${t.retentionDays}`,
      },
      { key: 'snapshot.volumeSizeGiB', label: 'Source volume size', value: a.volumeSizeGiB, unit: 'GiB' },
      { key: 'snapshot.sourceVolume', label: 'Source volume', value: a.volumeId ?? 'unknown' },
      {
        key: 'snapshot.sourceVolumeExists',
        label: 'Source volume still exists',
        value: a.sourceVolumeExists === null ? 'unknown' : a.sourceVolumeExists,
      },
      { key: 'snapshot.description', label: 'Description', value: a.description ?? '' },
      { key: 'snapshot.storageTier', label: 'Storage tier', value: a.storageTier ?? 'standard' },
    ];
    let savingsRequest: SavingsRequest | null = {
      kind: 'EBS_SNAPSHOT_DELETE',
      region: resource.region,
      sizeGiB: a.volumeSizeGiB,
    };
    if (a.storageTier && a.storageTier.toLowerCase() === 'archive') {
      savingsRequest = null;
      evidence.push({
        key: 'pricing.unsupported',
        label: 'Pricing not available',
        value: 'Archive-tier snapshot pricing is not supported by the savings engine',
      });
    }
    const label = resource.name ?? resource.resourceId;
    return {
      outcome: 'DETECTED',
      title: `EBS snapshot ${label} exceeds ${t.retentionDays}-day retention`,
      description:
        `Snapshot ${resource.resourceId} of ${a.volumeSizeGiB} GiB is ${round(age, 0)} days old. ` +
        (sourceGone
          ? 'Its source volume no longer exists, so this may be the only remaining copy of that data.'
          : 'Review whether it is still required by your retention or compliance policy.'),
      confidence,
      riskLevel: sourceGone ? 'HIGH' : 'MEDIUM',
      evidence,
      suggestedAction: {
        type: 'REVIEW_SNAPSHOT_RETENTION',
        summary: 'Review the snapshot against your retention and compliance requirements before deleting it.',
        steps: [
          'Confirm the snapshot is not required for compliance, legal hold, disaster recovery, or AMI registration.',
          'Confirm newer snapshots cover the data if the source volume still exists.',
          'Delete the snapshot manually, or archive it to the EBS Snapshots Archive tier if long-term retention is required.',
        ],
      },
      savingsRequest,
    };
  },
});
