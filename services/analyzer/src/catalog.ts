import type { RuleDefinitionSummary } from '@cloudsentry/shared-types';
import { idleEc2Rule } from './rules/idle-ec2';
import { unattachedEbsRule } from './rules/unattached-ebs';
import { unassociatedEipRule } from './rules/unassociated-eip';
import { underutilizedRdsRule } from './rules/underutilized-rds';
import { oldEbsSnapshotsRule } from './rules/old-ebs-snapshots';
import { idleNatGatewayRule } from './rules/idle-nat-gateway';
import type { AnyRuleDefinition } from './rules/types';

/** All detection rules, in evaluation order. */
export const RULES: readonly AnyRuleDefinition[] = [
  idleEc2Rule,
  unattachedEbsRule,
  unassociatedEipRule,
  underutilizedRdsRule,
  oldEbsSnapshotsRule,
  idleNatGatewayRule,
];

export function toRuleSummary(rule: AnyRuleDefinition): RuleDefinitionSummary {
  return {
    ruleId: rule.ruleId,
    name: rule.name,
    description: rule.description,
    resourceType: rule.resourceType,
    category: rule.category,
    version: rule.version,
    defaultSeverity: rule.defaultSeverity,
    defaultThresholds: { ...rule.defaultThresholds },
    thresholdDescriptions: { ...rule.thresholdDescriptions },
  };
}

export const RULE_CATALOG: readonly RuleDefinitionSummary[] = RULES.map(toRuleSummary);

export function getRuleCatalog(): RuleDefinitionSummary[] {
  return RULE_CATALOG.map((r) => ({ ...r, defaultThresholds: { ...r.defaultThresholds } }));
}

export function getRule(ruleId: string): AnyRuleDefinition | undefined {
  return RULES.find((r) => r.ruleId === ruleId);
}
