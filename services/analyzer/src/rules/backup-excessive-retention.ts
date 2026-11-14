import type { EvidenceItem } from '@cloudsentry/shared-types';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { maxRetentionDays: 365 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

/** Evidence lists at most this many offending backup rules. */
const MAX_LISTED_RULES = 20;

export const backupExcessiveRetentionRule = defineRule({
  ruleId: 'backup-excessive-retention',
  name: 'AWS Backup plan with long retention',
  description:
    'Backup plan with at least one rule that keeps recovery points indefinitely or longer than the retention ' +
    'threshold. Compliance requirements are unknown, so confidence is LOW. Retention cost is measured on ' +
    'vaults (backup-vault-old-recovery-points), so no savings are attached to the plan.',
  resourceType: 'BACKUP_PLAN',
  category: 'RETENTION',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    maxRetentionDays:
      'Backup rules that delete recovery points after more than this many days, or never, are flagged (days).',
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    if (resource.state === 'unknown')
      return notEvaluated('PLAN_DETAILS_UNAVAILABLE: backup plan rules could not be read');
    const a = resource.attributes;
    const offending = a.rules.filter(
      (r) => r.deleteAfterDays === null || r.deleteAfterDays > t.maxRetentionDays,
    );
    if (offending.length === 0) return NOT_DETECTED;

    const indefinite = offending.filter((r) => r.deleteAfterDays === null).length;
    const evidence: EvidenceItem[] = offending.slice(0, MAX_LISTED_RULES).map((r) => ({
      key: `rule.${r.ruleName}.retentionDays`,
      label:
        `Rule ${r.ruleName}` +
        (r.targetVaultName ? ` (vault ${r.targetVaultName})` : '') +
        (r.moveToColdStorageAfterDays !== null
          ? `, cold storage after ${r.moveToColdStorageAfterDays} days`
          : '') +
        (r.copyActionCount > 0 ? `, ${r.copyActionCount} copy action(s) with their own lifecycle` : ''),
      value: r.deleteAfterDays === null ? 'retained indefinitely' : r.deleteAfterDays,
      ...(r.deleteAfterDays === null ? {} : { unit: 'days' }),
      threshold: `<= ${t.maxRetentionDays}`,
    }));
    if (offending.length > MAX_LISTED_RULES) {
      evidence.push({
        key: 'rules.moreOffending',
        label: 'Further rules not listed',
        value: offending.length - MAX_LISTED_RULES,
      });
    }
    evidence.push(
      { key: 'rules.offending', label: 'Rules over the retention threshold', value: offending.length },
      { key: 'rules.total', label: 'Rules in plan', value: a.rules.length },
      { key: 'plan.lastExecution', label: 'Last execution', value: a.lastExecutionDate ?? 'unknown' },
    );

    const label = resource.name ?? a.backupPlanName;
    return {
      outcome: 'DETECTED',
      title: `Backup plan ${label} retains recovery points for over ${t.maxRetentionDays} days`,
      description:
        `${offending.length} of ${a.rules.length} rule(s) in backup plan ${a.backupPlanName} keep recovery points ` +
        `longer than ${t.maxRetentionDays} days` +
        (indefinite > 0 ? `, ${indefinite} of them indefinitely` : '') +
        '. Long retention may be required for compliance; if not, every additional month of retention is billed as backup storage.',
      confidence: 'LOW',
      riskLevel: 'MEDIUM',
      evidence,
      suggestedAction: {
        type: 'REDUCE_BACKUP_RETENTION',
        summary:
          'Confirm the retention requirement for each listed rule and shorten the lifecycle where it is not required.',
        steps: [
          'Confirm the legal, regulatory and business retention requirements for the protected resources with the data owner.',
          'For rules without a requirement, set "Expire" (delete after) in the rule lifecycle; consider cold storage for long-retention rules that support it.',
          'Update the plan through your infrastructure-as-code; lifecycle changes apply to new recovery points, so review existing ones in the vault separately.',
        ],
      },
      savingsRequest: null,
    };
  },
});
