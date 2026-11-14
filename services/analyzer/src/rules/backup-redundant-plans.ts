import type { EvidenceItem } from '@cloudsentry/shared-types';
import { truncatedListingReason, vaultListingGate } from './backup-shared';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

/** Evidence lists at most this many resources. */
const MAX_LISTED_RESOURCES = 10;

export const backupRedundantPlansRule = defineRule({
  ruleId: 'backup-redundant-plans',
  name: 'Resources backed up by several AWS Backup plans',
  description:
    'Backup vault containing recent recovery points of the same resources created by two or more backup ' +
    'plans. Overlapping plans can store duplicate backups; some overlaps are intentional (for example daily ' +
    'and monthly plans with different retention). The overlap volume cannot be measured from metadata, so ' +
    'no savings are estimated.',
  resourceType: 'BACKUP_VAULT',
  category: 'OVERPROVISIONED',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: {},
  thresholdDescriptions: {},
  evaluate(resource) {
    const gate = vaultListingGate(resource);
    if (gate) return gate;
    const a = resource.attributes;
    const overlaps = [...a.resourcesWithMultiplePlans].sort((x, y) =>
      x.resourceArn.localeCompare(y.resourceArn),
    );
    if (overlaps.length === 0)
      return a.truncated ? notEvaluated(truncatedListingReason(resource)) : NOT_DETECTED;

    const evidence: EvidenceItem[] = overlaps.slice(0, MAX_LISTED_RESOURCES).map((r, i) => ({
      key: `overlap.${i + 1}`,
      label: `${r.resourceType} ${r.resourceArn}`,
      value: [...r.planIds].sort().join(', '),
      threshold: '>= 2 plans',
    }));
    evidence.push({
      key: 'overlap.resources',
      label:
        'Resources backed up by two or more plans (last 35 days; discovery lists at most 50)' +
        (a.truncated ? '; at least this many, recovery point listing was truncated' : ''),
      value: overlaps.length,
    });
    if (overlaps.length > MAX_LISTED_RESOURCES) {
      evidence.push({
        key: 'overlap.notListed',
        label: 'Further resources not listed',
        value: overlaps.length - MAX_LISTED_RESOURCES,
      });
    }
    const planIds = [...new Set(overlaps.flatMap((r) => r.planIds))].sort();
    evidence.push({ key: 'overlap.planIds', label: 'Backup plans involved', value: planIds.join(', ') });

    const label = resource.name ?? a.vaultName;
    return {
      outcome: 'DETECTED',
      title: `Overlapping backup plans in vault ${label}`,
      description:
        `${overlaps.length} resource(s) in vault ${a.vaultName} received recovery points from ${planIds.length} different ` +
        'backup plans in the last 35 days. If the plans protect the same data with similar schedules, the duplicate ' +
        'backups add storage cost without adding protection.',
      confidence: 'MEDIUM',
      riskLevel: 'MEDIUM',
      evidence,
      suggestedAction: {
        type: 'CONSOLIDATE_BACKUP_PLANS',
        summary:
          'Review the overlapping plans and consolidate them where they protect the same resources redundantly.',
        steps: [
          'Compare the schedules, retention and copy actions of the listed plans; overlaps with different purposes (daily vs monthly, cross-region copies) may be intentional.',
          'Check the resource assignments (tags, resource ARNs) that make each resource match several plans.',
          'Consolidate into one plan with multiple rules, or narrow the resource assignments, through your infrastructure-as-code.',
        ],
      },
      savingsRequest: null,
    };
  },
});
