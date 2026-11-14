import { efsSizeEvidence, efsStateGate, gib, isOneZone } from './efs-shared';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { minStandardGb: 50 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const efsMissingLifecycleRule = defineRule({
  ruleId: 'efs-missing-lifecycle',
  name: 'EFS file system without lifecycle management',
  description:
    'EFS file system holding a significant amount of Standard storage with no lifecycle policy to move ' +
    'files to Infrequent Access. The access pattern is unknown, so the estimate is an upper bound and ' +
    'confidence is LOW.',
  resourceType: 'EFS_FILE_SYSTEM',
  category: 'OVERPROVISIONED',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    minStandardGb: 'Standard-class storage must be at least this size (GiB, 2^30 bytes).',
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const gate = efsStateGate(resource);
    if (gate) return gate;
    const a = resource.attributes;
    if (a.lifecycle === null) {
      return notEvaluated(
        'LIFECYCLE_CONFIGURATION_UNKNOWN: DescribeLifecycleConfiguration could not be read',
      );
    }
    if (a.lifecycle.transitionToIA !== null) return NOT_DETECTED;
    const standardGb = gib(a.sizeBytesStandard);
    if (standardGb < t.minStandardGb) return NOT_DETECTED;

    const label = resource.name ?? a.fileSystemId;
    return {
      outcome: 'DETECTED',
      title: `No Infrequent Access lifecycle on EFS file system ${label}`,
      description:
        `File system ${a.fileSystemId} stores ${standardGb} GiB in the Standard class and has no lifecycle policy ` +
        'to move files that are not accessed to Infrequent Access, which costs a fraction of Standard storage. ' +
        'Files that are read often should stay in Standard because IA reads are charged per GB.',
      confidence: 'LOW',
      riskLevel: 'LOW',
      evidence: [
        {
          key: 'lifecycle.transitionToIA',
          label: 'Transition to IA',
          value: 'not configured',
          threshold: 'not configured',
        },
        {
          key: 'lifecycle.transitionToArchive',
          label: 'Transition to Archive',
          value: a.lifecycle.transitionToArchive ?? 'not configured',
        },
        {
          key: 'size.standardGibThreshold',
          label: 'Standard storage',
          value: standardGb,
          unit: 'GiB',
          threshold: `>= ${t.minStandardGb}`,
        },
        ...efsSizeEvidence(resource).filter((e) => e.key !== 'size.standardGib'),
      ],
      suggestedAction: {
        type: 'ENABLE_STORAGE_LIFECYCLE',
        summary:
          'Consider a lifecycle policy that moves files not accessed for 30 days to Infrequent Access.',
        steps: [
          'Review how often files are read: frequently read data costs more in IA because of per-GB access charges.',
          'Add a lifecycle policy (Transition into IA: AFTER_30_DAYS) through your infrastructure-as-code, optionally with "Transition into Standard: on first access".',
          'Monitor storage class sizes and IA access charges over the following months.',
        ],
      },
      savingsRequest: {
        kind: 'EFS_LIFECYCLE_TO_IA',
        region: resource.region,
        standardGb,
        oneZone: isOneZone(resource),
      },
    };
  },
});
