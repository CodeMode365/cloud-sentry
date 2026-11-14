import {
  DEFAULT_IGNORE_TAG_KEY,
  type DetectedIssue,
  type DetectionResult,
  type DetectionSettings,
  type NormalizedResource,
  type RuleEvaluation,
  type ThresholdValues,
} from '@cloudsentry/shared-types';
import { errorMessage, findingIdFor } from '@cloudsentry/utilities';
import { RULES } from './catalog';
import type { AnyRuleDefinition, ResourceIndex, RuleContext, RuleOutcome } from './rules/types';

export interface ResolvedRuleConfig {
  enabled: boolean;
  thresholds: ThresholdValues;
  /** Override keys that were ignored (unknown key or invalid value). */
  ignoredOverrides: string[];
}

/**
 * Merges tenant overrides over rule defaults. Unknown keys are ignored; non-finite or negative values fall
 * back to the default. The result always contains exactly the rule's threshold keys.
 */
export function resolveRuleConfig(
  rule: AnyRuleDefinition,
  settings: DetectionSettings | null,
): ResolvedRuleConfig {
  const ruleSettings = settings?.rules[rule.ruleId];
  const overrides = ruleSettings?.thresholds ?? {};
  const thresholds: ThresholdValues = {};
  const ignoredOverrides: string[] = [];
  for (const [key, defaultValue] of Object.entries(rule.defaultThresholds)) {
    const value = overrides[key];
    if (value === undefined) {
      thresholds[key] = defaultValue;
    } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      thresholds[key] = value;
    } else {
      thresholds[key] = defaultValue;
      ignoredOverrides.push(key);
    }
  }
  for (const key of Object.keys(overrides)) {
    if (!(key in rule.defaultThresholds)) ignoredOverrides.push(key);
  }
  return { enabled: ruleSettings?.enabled ?? true, thresholds, ignoredOverrides };
}

export function buildResourceIndex(resources: readonly NormalizedResource[]): ResourceIndex {
  const snapshotsByVolume = new Map<string, NormalizedResource[]>();
  for (const r of resources) {
    if (r.resourceType === 'EBS_SNAPSHOT' && r.attributes.volumeId) {
      const key = `${r.accountId}|${r.region}|${r.attributes.volumeId}`;
      const list = snapshotsByVolume.get(key) ?? [];
      list.push(r);
      snapshotsByVolume.set(key, list);
    }
  }
  return { all: resources, snapshotsByVolume };
}

export function isExcludedByTag(resource: NormalizedResource, ignoreTagKey: string): boolean {
  return resource.tags[ignoreTagKey]?.trim().toLowerCase() === 'true';
}

function evaluateRule(rule: AnyRuleDefinition, resource: NormalizedResource, ctx: RuleContext): RuleOutcome {
  // The engine only passes resources whose type matches rule.resourceType.
  return (rule.evaluate as (r: NormalizedResource, c: RuleContext) => RuleOutcome)(resource, ctx);
}

export interface RunDetectionOptions {
  settings: DetectionSettings | null;
  now: Date;
  /** Defaults to all registered rules. */
  rules?: readonly AnyRuleDefinition[];
}

/**
 * Runs every enabled rule against every resource of the rule's type. Deterministic: the same resources,
 * settings and clock always produce the same result. Rule exceptions are captured per resource as
 * NOT_EVALUATED with reason `RULE_ERROR: ...` so one bad record never aborts the run.
 */
export function runDetection(
  resources: readonly NormalizedResource[],
  options: RunDetectionOptions,
): DetectionResult {
  const rules = options.rules ?? RULES;
  const ignoreTagKey = options.settings?.ignoreTagKey || DEFAULT_IGNORE_TAG_KEY;
  const index = buildResourceIndex(resources);
  const issues: DetectedIssue[] = [];
  const evaluations: RuleEvaluation[] = [];
  const rulesExecuted: DetectionResult['rulesExecuted'] = [];
  const configs = new Map(rules.map((rule) => [rule.ruleId, resolveRuleConfig(rule, options.settings)]));
  const ruleThresholds = new Map([...configs].map(([ruleId, config]) => [ruleId, config.thresholds]));

  for (const rule of rules) {
    const config = configs.get(rule.ruleId) ?? resolveRuleConfig(rule, options.settings);
    rulesExecuted.push({
      ruleId: rule.ruleId,
      ruleVersion: rule.version,
      enabled: config.enabled,
      thresholds: config.thresholds,
    });
    if (!config.enabled) continue;
    const ctx: RuleContext = { thresholds: config.thresholds, now: options.now, index, ruleThresholds };

    for (const resource of resources) {
      if (resource.resourceType !== rule.resourceType) continue;
      const base = {
        ruleId: rule.ruleId,
        resourceKey: resource.resourceKey,
        resourceType: resource.resourceType,
        accountId: resource.accountId,
        region: resource.region,
        resourceId: resource.resourceId,
      };
      if (isExcludedByTag(resource, ignoreTagKey)) {
        evaluations.push({
          ...base,
          outcome: 'NOT_EVALUATED',
          reason: `EXCLUDED_BY_TAG: ${ignoreTagKey}=true`,
        });
        continue;
      }
      let outcome: RuleOutcome;
      try {
        outcome = evaluateRule(rule, resource, ctx);
      } catch (error) {
        outcome = { outcome: 'NOT_EVALUATED', reason: `RULE_ERROR: ${errorMessage(error)}` };
      }
      if (outcome.outcome === 'NOT_EVALUATED') {
        evaluations.push({ ...base, outcome: 'NOT_EVALUATED', reason: outcome.reason });
        continue;
      }
      evaluations.push({ ...base, outcome: outcome.outcome });
      if (outcome.outcome === 'DETECTED') {
        issues.push({
          findingId: findingIdFor(resource.accountId, resource.region, rule.ruleId, resource.resourceId),
          ruleId: rule.ruleId,
          ruleName: rule.name,
          ruleVersion: rule.version,
          category: rule.category,
          resourceType: resource.resourceType,
          resourceKey: resource.resourceKey,
          accountId: resource.accountId,
          region: resource.region,
          resourceId: resource.resourceId,
          resourceName: resource.name,
          title: outcome.title,
          description: outcome.description,
          baseSeverity: outcome.severity ?? rule.defaultSeverity,
          confidence: outcome.confidence,
          riskLevel: outcome.riskLevel,
          evidence: outcome.evidence,
          thresholds: config.thresholds,
          suggestedAction: outcome.suggestedAction,
          savingsRequest: outcome.savingsRequest,
        });
      }
    }
  }
  return applySupersession({ issues, evaluations, rulesExecuted });
}

/**
 * Overlapping rules on one resource: a stronger "idle/unused" finding replaces the weaker "underutilized"
 * one so savings are never counted twice (e.g. delete an idle cache vs. rightsize it). The weaker rule's
 * evaluation becomes NOT_DETECTED (reason SUPERSEDED_BY:<rule>), which also resolves a previously open
 * weaker finding. Keys: superseded rule -> rules that supersede it.
 */
export const SUPERSEDED_BY: Readonly<Record<string, readonly string[]>> = {
  'underutilized-elasticache': ['idle-elasticache'],
  'efs-missing-lifecycle': ['unused-efs'],
  'dynamodb-overprovisioned-capacity': ['unused-dynamodb-table'],
  'dynamodb-capacity-mode': ['unused-dynamodb-table'],
  'underutilized-eks-nodes': ['idle-eks-cluster'],
  'eks-oversized-requests': ['idle-eks-cluster'],
  'redshift-pause-schedule': ['idle-redshift-cluster'],
};

export function applySupersession(result: DetectionResult): DetectionResult {
  const detected = new Map<string, DetectedIssue>();
  for (const issue of result.issues) detected.set(`${issue.ruleId}|${issue.resourceKey}`, issue);
  const supersededBy = new Map<string, string>();
  for (const issue of result.issues) {
    const stronger = (SUPERSEDED_BY[issue.ruleId] ?? []).find((r) =>
      detected.has(`${r}|${issue.resourceKey}`),
    );
    if (stronger) supersededBy.set(`${issue.ruleId}|${issue.resourceKey}`, stronger);
  }
  const issues = result.issues
    .filter((i) => !supersededBy.has(`${i.ruleId}|${i.resourceKey}`))
    .map((issue) => priceArm64AfterRightsizing(issue, detected));
  const evaluations = result.evaluations.map((e) => {
    const stronger = supersededBy.get(`${e.ruleId}|${e.resourceKey}`);
    return stronger ? { ...e, outcome: 'NOT_DETECTED' as const, reason: `SUPERSEDED_BY:${stronger}` } : e;
  });
  return { ...result, issues, evaluations };
}

/**
 * arm64 migration and memory rightsizing both reduce the same GB-second cost. When both are detected, the
 * arm64 saving is priced at the rightsized memory so the two estimates add up instead of overlapping.
 */
function priceArm64AfterRightsizing(
  issue: DetectedIssue,
  detected: Map<string, DetectedIssue>,
): DetectedIssue {
  if (issue.ruleId !== 'lambda-arm64-migration' || issue.savingsRequest?.kind !== 'LAMBDA_ARM64_MIGRATION')
    return issue;
  const memory = detected.get(`lambda-overprovisioned-memory|${issue.resourceKey}`)?.savingsRequest;
  if (memory?.kind !== 'LAMBDA_MEMORY_RIGHTSIZE') return issue;
  return {
    ...issue,
    savingsRequest: { ...issue.savingsRequest, memoryMb: memory.recommendedMemoryMb },
    evidence: [
      ...issue.evidence,
      {
        key: 'pricing.memoryAfterRightsizing',
        label: 'Priced at the rightsized memory (see memory recommendation)',
        value: memory.recommendedMemoryMb,
        unit: 'MB',
      },
    ],
  };
}
