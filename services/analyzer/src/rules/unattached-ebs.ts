import type { ConfidenceLevel, EvidenceItem } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { ageInDays } from './metric-helpers';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { minAgeDays: 7, highConfidenceAgeDays: 30 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const unattachedEbsRule = defineRule({
  ruleId: 'unattached-ebs',
  name: 'Unattached EBS volume',
  description: 'EBS volume in the "available" state with no attachments, older than the minimum age.',
  resourceType: 'EBS_VOLUME',
  category: 'UNUSED',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    minAgeDays:
      'Volumes younger than this (days since creation) are not flagged, to avoid transient volumes.',
    highConfidenceAgeDays: 'Volumes unattached and older than this (days) are reported with HIGH confidence.',
  },
  evaluate(resource, { thresholds, now, index }) {
    const t = thresholds as Thresholds;
    if (resource.state === 'in-use') return NOT_DETECTED;
    if (resource.state !== 'available') return notEvaluated(`TRANSIENT_STATE: ${resource.state}`);
    const attrs = resource.attributes;
    if (attrs.attachments.some((a) => a.state !== 'detached')) return NOT_DETECTED;

    const age = ageInDays(resource.createdAt, now);
    if (age === null) return notEvaluated('CREATION_TIME_UNKNOWN');
    if (age < t.minAgeDays) return NOT_DETECTED;

    const snapshots =
      index.snapshotsByVolume.get(`${resource.accountId}|${resource.region}|${resource.resourceId}`) ?? [];
    const latestSnapshot = snapshots
      .map((s) => s.createdAt)
      .filter((d): d is string => !!d)
      .sort()
      .at(-1);
    const confidence: ConfidenceLevel = age >= t.highConfidenceAgeDays ? 'HIGH' : 'MEDIUM';
    const tagCount = Object.keys(resource.tags).length;

    const evidence: EvidenceItem[] = [
      { key: 'volume.state', label: 'Volume state', value: resource.state },
      { key: 'volume.attachments', label: 'Active attachments', value: 0 },
      { key: 'volume.sizeGiB', label: 'Size', value: attrs.sizeGiB, unit: 'GiB' },
      { key: 'volume.type', label: 'Volume type', value: attrs.volumeType },
      {
        key: 'volume.ageDays',
        label: 'Age',
        value: round(age, 1),
        unit: 'days',
        threshold: `>= ${t.minAgeDays}`,
      },
      {
        key: 'volume.tagCount',
        label: 'Tags',
        value:
          tagCount === 0
            ? 'none'
            : Object.entries(resource.tags)
                .map(([k, v]) => `${k}=${v}`)
                .join(', '),
      },
      { key: 'snapshot.count', label: 'Snapshots of this volume (discovered)', value: snapshots.length },
      ...(latestSnapshot
        ? [{ key: 'snapshot.latest', label: 'Most recent snapshot', value: latestSnapshot }]
        : []),
    ];
    const label = resource.name ?? resource.resourceId;
    return {
      outcome: 'DETECTED',
      title: `Unattached EBS volume ${label}`,
      description:
        `Volume ${resource.resourceId} (${attrs.sizeGiB} GiB ${attrs.volumeType}) has been unattached for at least ` +
        `${round(age, 0)} days since creation and is still billed for provisioned storage. ` +
        (snapshots.length > 0
          ? `${snapshots.length} snapshot(s) of it exist.`
          : 'No snapshots of it were found.'),
      confidence,
      riskLevel: snapshots.length > 0 ? 'LOW' : 'MEDIUM',
      evidence,
      suggestedAction: {
        type: 'DELETE_VOLUME',
        summary:
          'Confirm the data is no longer needed, take a snapshot if in doubt, then delete the volume manually.',
        steps: [
          'Identify the owner from tags and confirm the volume is not awaiting re-attachment.',
          snapshots.length > 0
            ? 'Verify the most recent snapshot contains the data you may need to restore.'
            : 'Create a snapshot first if the data might be needed later (snapshot storage is billed separately).',
          'Delete the volume. CloudSentry never deletes resources.',
        ],
      },
      savingsRequest: {
        kind: 'EBS_VOLUME_DELETE',
        region: resource.region,
        volumeType: attrs.volumeType,
        sizeGiB: attrs.sizeGiB,
      },
    };
  },
});
