import type { EvidenceItem } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { LAMBDA_COMMON_DEFAULTS, LAMBDA_COVERAGE_DESCRIPTION, lambdaFunctionEvidence } from './lambda-shared';
import {
  coverageEvidence,
  observationEvidence,
  readMetric,
  readMetrics,
  requireObservation,
} from './metric-helpers';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { timeoutRatio: 0.8, ...LAMBDA_COMMON_DEFAULTS };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const lambdaNearTimeoutRule = defineRule({
  ruleId: 'lambda-near-timeout',
  name: 'Lambda function running near its timeout',
  description:
    'Invoked Lambda function whose hourly maximum duration is routinely close to its configured timeout. ' +
    'Time spent waiting near the timeout is billed and risks timeouts and retries (inefficient execution ' +
    'duration). No savings are claimed.',
  resourceType: 'LAMBDA_FUNCTION',
  category: 'OVERPROVISIONED',
  version: 1,
  defaultSeverity: 'LOW',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    timeoutRatio:
      'p95 of hourly Duration:Maximum must be at least this fraction (0-1) of the configured timeout.',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage: LAMBDA_COVERAGE_DESCRIPTION,
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const a = resource.attributes;
    if (a.timeoutSeconds <= 0) return notEvaluated('TIMEOUT_UNKNOWN');
    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);

    const reads = readMetrics(
      resource,
      { invocations: ['Invocations', 'Sum'], durationMax: ['Duration', 'Maximum'] },
      t.minCoverage,
    );
    if (!reads.ok) return notEvaluated(reads.reason);
    const { invocations, durationMax } = reads.values;
    const invocationCount = invocations.stats.sum;
    const p95 = durationMax.stats.p95;
    if (invocationCount === null || p95 === null) return notEvaluated('METRIC_STATISTICS_INCOMPLETE');
    if (invocationCount <= 0) return NOT_DETECTED;

    const timeoutMs = a.timeoutSeconds * 1000;
    const thresholdMs = t.timeoutRatio * timeoutMs;
    if (p95 < thresholdMs) return NOT_DETECTED;

    const evidence: EvidenceItem[] = [
      {
        key: 'duration.maxP95Ms',
        label: 'p95 of hourly maximum duration',
        value: round(p95, 0),
        unit: 'ms',
        threshold: `>= ${round(thresholdMs, 0)} (${t.timeoutRatio} x timeout)`,
      },
      {
        key: 'duration.timeoutRatio',
        label: 'p95 maximum duration / timeout',
        value: round(p95 / timeoutMs, 3),
      },
      ...(durationMax.stats.maximum !== null
        ? [
            {
              key: 'duration.maxMs',
              label: 'Longest hourly maximum duration',
              value: round(durationMax.stats.maximum, 0),
              unit: 'ms',
            },
          ]
        : []),
      {
        key: 'invocations.total',
        label: 'Invocations in observation period',
        value: round(invocationCount, 0),
        threshold: '> 0',
      },
    ];
    for (const [metric, label] of [
      ['Errors', 'Errors in observation period'],
      ['Throttles', 'Throttles in observation period'],
    ] as const) {
      const read = readMetric(resource, metric, 'Sum', 0);
      if (read.ok && read.stats.sum !== null) {
        evidence.push({ key: `${metric.toLowerCase()}.total`, label, value: round(read.stats.sum, 0) });
      }
    }
    evidence.push(
      observationEvidence(obs.observableDays, t.minObservationDays),
      coverageEvidence(Math.min(invocations.stats.coverage, durationMax.stats.coverage), t.minCoverage),
      ...lambdaFunctionEvidence(resource),
    );

    const label = resource.name ?? a.functionName;
    return {
      outcome: 'DETECTED',
      title: `Lambda function ${label} runs close to its timeout`,
      description:
        `The 95th percentile of the hourly maximum duration of ${a.functionName} is ${round(p95, 0)} ms, ` +
        `${round((p95 / timeoutMs) * 100, 0)}% of its ${a.timeoutSeconds}-second timeout, over ` +
        `${round(obs.observableDays, 0)} days. Long waits are billed and invocations that hit the timeout fail and may be retried.`,
      confidence: 'MEDIUM',
      riskLevel: 'LOW',
      evidence,
      suggestedAction: {
        type: 'REVIEW_FUNCTION_DURATION',
        summary: 'Review why invocations run close to the timeout before changing memory or the timeout.',
        steps: [
          'Check logs and traces (for example AWS X-Ray) for slow downstream calls, retries or waiting on external services.',
          'Check Errors for timeout failures and whether retries (asynchronous invocations, event source mappings) multiply the billed duration.',
          'Set client timeouts on downstream calls below the function timeout, and consider more memory (more CPU) if the work is CPU-bound.',
          'Adjust the timeout or code through your deployment pipeline after testing.',
        ],
      },
      savingsRequest: null,
    };
  },
});
