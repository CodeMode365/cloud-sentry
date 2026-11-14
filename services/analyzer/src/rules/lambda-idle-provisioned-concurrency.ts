import type { EvidenceItem } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { LAMBDA_COMMON_DEFAULTS, LAMBDA_COVERAGE_DESCRIPTION, lambdaFunctionEvidence } from './lambda-shared';
import { observationEvidence, pct, readMetricByKey, requireObservation } from './metric-helpers';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { maxUtilizationPercent: 20, headroomFactor: 1.5, ...LAMBDA_COMMON_DEFAULTS };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

/** Utilization key for one provisioned concurrency configuration (alias or version). */
export function provisionedConcurrencyKey(qualifier: string): string {
  return `ProvisionedConcurrencyUtilization:Maximum:${qualifier}`;
}

interface FlaggedConfig {
  qualifier: string;
  allocated: number;
  maxUtilizationPercent: number;
  recommended: number;
}

export const lambdaIdleProvisionedConcurrencyRule = defineRule({
  ruleId: 'lambda-idle-provisioned-concurrency',
  name: 'Idle Lambda provisioned concurrency',
  description:
    'Provisioned concurrency configurations whose peak utilization stayed low. Provisioned concurrency is ' +
    'billed for the whole allocation whether or not it is used. One finding per function aggregates its ' +
    'configurations.',
  resourceType: 'LAMBDA_FUNCTION',
  category: 'IDLE',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    maxUtilizationPercent:
      'Maximum ProvisionedConcurrencyUtilization of a configuration must be below this value (percent; CloudWatch reports a 0-1 ratio, converted to percent).',
    headroomFactor:
      'Recommended allocation = ceil(allocated x peak utilization x this factor) (multiplier, minimum 0).',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage: LAMBDA_COVERAGE_DESCRIPTION,
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const a = resource.attributes;
    const configs = a.provisionedConcurrency.filter((c) => c.allocated > 0);
    if (configs.length === 0) return NOT_DETECTED;

    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);

    const flagged: FlaggedConfig[] = [];
    const unevaluated: { qualifier: string; reason: string }[] = [];
    for (const config of configs) {
      const read = readMetricByKey(resource, provisionedConcurrencyKey(config.qualifier), t.minCoverage);
      if (!read.ok) {
        unevaluated.push({ qualifier: config.qualifier, reason: read.reason });
        continue;
      }
      if (read.stats.maximum === null) {
        unevaluated.push({ qualifier: config.qualifier, reason: 'METRIC_STATISTICS_INCOMPLETE' });
        continue;
      }
      // CloudWatch reports ProvisionedConcurrencyUtilization as a ratio (0.5 = 50% of the allocation in use).
      const maxUtilizationPercent = read.stats.maximum * 100;
      if (maxUtilizationPercent >= t.maxUtilizationPercent) continue;
      const recommended = Math.max(
        0,
        Math.ceil(round(config.allocated * (maxUtilizationPercent / 100) * t.headroomFactor, 6)),
      );
      if (recommended >= config.allocated) continue;
      flagged.push({ qualifier: config.qualifier, allocated: config.allocated, maxUtilizationPercent, recommended });
    }

    if (flagged.length === 0) {
      const first = unevaluated[0];
      return first ? notEvaluated(`${first.reason} (qualifier ${first.qualifier})`) : NOT_DETECTED;
    }

    const currentAllocated = flagged.reduce((s, f) => s + f.allocated, 0);
    const recommendedAllocated = flagged.reduce((s, f) => s + f.recommended, 0);
    const evidence: EvidenceItem[] = flagged.map((f) => ({
      key: `provisionedConcurrency.${f.qualifier}`,
      label: `Qualifier ${f.qualifier}: peak utilization (allocated ${f.allocated}, recommended ${f.recommended})`,
      value: pct(f.maxUtilizationPercent),
      unit: '%',
      threshold: `< ${t.maxUtilizationPercent}`,
    }));
    evidence.push(
      { key: 'provisionedConcurrency.currentTotal', label: 'Allocated (flagged configurations)', value: currentAllocated },
      {
        key: 'provisionedConcurrency.recommendedTotal',
        label: 'Recommended (flagged configurations)',
        value: recommendedAllocated,
        threshold: `ceil(allocated x peak x ${t.headroomFactor})`,
      },
      observationEvidence(obs.observableDays, t.minObservationDays),
      ...lambdaFunctionEvidence(resource),
    );
    if (unevaluated.length > 0) {
      evidence.push({
        key: 'provisionedConcurrency.notEvaluated',
        label: 'Configurations not evaluated',
        value: unevaluated.map((u) => `${u.qualifier} (${u.reason})`).join('; '),
      });
    }

    const label = resource.name ?? a.functionName;
    const qualifiers = flagged.map((f) => f.qualifier).join(', ');
    return {
      outcome: 'DETECTED',
      title: `Idle provisioned concurrency on Lambda function ${label}`,
      description:
        `Function ${a.functionName} keeps ${currentAllocated} provisioned concurrent executions on ${qualifiers}, ` +
        `but peak utilization stayed below ${t.maxUtilizationPercent}% over ${round(obs.observableDays, 0)} days. ` +
        `About ${recommendedAllocated} would cover the observed peak with ${t.headroomFactor}x headroom.`,
      confidence: 'MEDIUM',
      riskLevel: 'MEDIUM',
      evidence,
      suggestedAction: {
        type: 'REDUCE_PROVISIONED_CONCURRENCY',
        summary: `Consider reducing provisioned concurrency from ${currentAllocated} to ${recommendedAllocated} on ${qualifiers}.`,
        steps: [
          'Confirm whether the allocation exists for known peaks (launches, seasonal events, scheduled batch windows) outside this observation window.',
          'Consider Application Auto Scaling or scheduled scaling for provisioned concurrency instead of a fixed allocation.',
          'Lower the allocation through your deployment pipeline or infrastructure-as-code; invocations above the allocation fall back to on-demand concurrency with cold starts.',
          'Monitor ProvisionedConcurrencySpilloverInvocations and latency after the change.',
        ],
      },
      savingsRequest: {
        kind: 'LAMBDA_PROVISIONED_CONCURRENCY_REDUCE',
        region: resource.region,
        architecture: a.architecture,
        memoryMb: a.memoryMb,
        currentAllocated,
        recommendedAllocated,
      },
    };
  },
});
