import type { EvidenceItem, SavingsRequest } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import {
  LAMBDA_COMMON_DEFAULTS,
  LAMBDA_COVERAGE_DESCRIPTION,
  lambdaFunctionEvidence,
  monthlyDurationSeconds,
  roundUpTo,
} from './lambda-shared';
import {
  coverageEvidence,
  isMissingData,
  observationEvidence,
  pct,
  readMetric,
  requireObservation,
} from './metric-helpers';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

/** Lambda's minimum memory size (MB). */
const LAMBDA_MIN_MEMORY_MB = 128;

const DEFAULTS = {
  minMemoryMb: 512,
  maxMemoryUtilizationPercent: 40,
  memoryHeadroomFactor: 1.3,
  ...LAMBDA_COMMON_DEFAULTS,
};
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const lambdaOverprovisionedMemoryRule = defineRule({
  ruleId: 'lambda-overprovisioned-memory',
  name: 'Over-provisioned Lambda memory',
  description:
    'Invoked Lambda function whose peak memory use (from Lambda Insights) stayed far below its configured ' +
    'memory. Requires Lambda Insights; functions without it are not evaluated.',
  resourceType: 'LAMBDA_FUNCTION',
  category: 'OVERPROVISIONED',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    minMemoryMb: 'Only functions configured with at least this much memory are evaluated (MB).',
    maxMemoryUtilizationPercent:
      'Maximum of Lambda Insights memory_utilization:Maximum must be below this value (percent).',
    memoryHeadroomFactor:
      'Recommended memory = peak used_memory_max x this factor, rounded up to 64 MB (multiplier, minimum 128 MB).',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage: LAMBDA_COVERAGE_DESCRIPTION,
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const a = resource.attributes;
    if (a.memoryMb < t.minMemoryMb) return NOT_DETECTED;

    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);
    const observed = obs.observableDays;

    const invocations = readMetric(resource, 'Invocations', 'Sum', t.minCoverage);
    if (!invocations.ok) return notEvaluated(invocations.reason);
    const invocationCount = invocations.stats.sum;
    if (invocationCount === null) return notEvaluated('METRIC_STATISTICS_INCOMPLETE: Invocations:Sum');
    if (invocationCount <= 0) return NOT_DETECTED;

    const utilization = readMetric(resource, 'memory_utilization', 'Maximum', t.minCoverage);
    const used = readMetric(resource, 'used_memory_max', 'Maximum', t.minCoverage);
    for (const read of [utilization, used]) {
      if (read.ok) continue;
      if (isMissingData(read)) {
        return notEvaluated(
          `LAMBDA_INSIGHTS_NOT_ENABLED: ${read.reason} (enable Lambda Insights to measure memory use)`,
        );
      }
      return notEvaluated(read.reason);
    }
    if (!utilization.ok || !used.ok) return notEvaluated('METRIC_STATISTICS_INCOMPLETE');
    const maxUtilization = utilization.stats.maximum;
    const maxUsedMb = used.stats.maximum;
    if (maxUtilization === null || maxUsedMb === null) return notEvaluated('METRIC_STATISTICS_INCOMPLETE');
    if (maxUtilization >= t.maxMemoryUtilizationPercent) return NOT_DETECTED;

    const recommendedMb = Math.max(LAMBDA_MIN_MEMORY_MB, roundUpTo(maxUsedMb * t.memoryHeadroomFactor, 64));
    if (recommendedMb >= a.memoryMb) return NOT_DETECTED;

    const coverage = Math.min(invocations.stats.coverage, utilization.stats.coverage, used.stats.coverage);
    const evidence: EvidenceItem[] = [
      {
        key: 'memory.configuredMb',
        label: 'Configured memory',
        value: a.memoryMb,
        unit: 'MB',
        threshold: `>= ${t.minMemoryMb}`,
      },
      {
        key: 'memory.utilizationMax',
        label: 'Peak memory utilization (Lambda Insights)',
        value: pct(maxUtilization),
        unit: '%',
        threshold: `< ${t.maxMemoryUtilizationPercent}`,
      },
      { key: 'memory.usedMaxMb', label: 'Peak memory used', value: round(maxUsedMb, 1), unit: 'MB' },
      {
        key: 'memory.recommendedMb',
        label: 'Recommended memory',
        value: recommendedMb,
        unit: 'MB',
        threshold: `peak x ${t.memoryHeadroomFactor}, rounded up to 64 MB`,
      },
      {
        key: 'invocations.total',
        label: 'Invocations in observation period',
        value: round(invocationCount, 0),
        threshold: '> 0',
      },
      observationEvidence(observed, t.minObservationDays),
      coverageEvidence(coverage, t.minCoverage),
      ...lambdaFunctionEvidence(resource),
    ];

    let savingsRequest: SavingsRequest | null = null;
    const duration = monthlyDurationSeconds(resource, observed, 0);
    if (duration.ok) {
      evidence.push({
        key: 'duration.monthlySeconds',
        label: 'Billed duration per month (normalised to 30 days)',
        value: round(duration.seconds, 1),
        unit: 's',
      });
      savingsRequest = {
        kind: 'LAMBDA_MEMORY_RIGHTSIZE',
        region: resource.region,
        architecture: a.architecture,
        currentMemoryMb: a.memoryMb,
        recommendedMemoryMb: recommendedMb,
        monthlyDurationSeconds: round(duration.seconds, 3),
      };
    } else {
      evidence.push({
        key: 'pricing.unsupported',
        label: 'Pricing not available',
        value: `Billed duration could not be read (${duration.reason})`,
      });
    }

    const label = resource.name ?? a.functionName;
    return {
      outcome: 'DETECTED',
      title: `Over-provisioned memory on Lambda function ${label}`,
      description:
        `Function ${a.functionName} is configured with ${a.memoryMb} MB but peaked at ${pct(maxUtilization)}% memory ` +
        `utilization (${round(maxUsedMb, 0)} MB used) across ${round(invocationCount, 0)} invocations over ` +
        `${round(observed, 0)} days. About ${recommendedMb} MB would keep ${t.memoryHeadroomFactor}x headroom over the observed peak.`,
      confidence: 'MEDIUM',
      riskLevel: 'MEDIUM',
      evidence,
      suggestedAction: {
        type: 'RIGHTSIZE_FUNCTION_MEMORY',
        summary: `Consider lowering memory from ${a.memoryMb} MB to about ${recommendedMb} MB after testing.`,
        steps: [
          'Check whether rare inputs (large payloads, cold starts, batch sizes) need more memory than observed in this window.',
          'Lambda allocates CPU in proportion to memory: test the function at the recommended size (for example with AWS Lambda Power Tuning) and compare duration and cost.',
          'Change the memory setting through your deployment pipeline or infrastructure-as-code so the change is reviewed and reversible.',
          'Monitor Duration, Errors and memory utilization after the change and revert if duration or error rates increase.',
        ],
      },
      savingsRequest,
    };
  },
});
