import { round } from '@cloudsentry/utilities';
import {
  gbSeconds,
  LAMBDA_COMMON_DEFAULTS,
  LAMBDA_COVERAGE_DESCRIPTION,
  lambdaFunctionEvidence,
  monthlyDurationSeconds,
} from './lambda-shared';
import { observationEvidence, requireObservation } from './metric-helpers';
import { lambdaRuntimeSupportsArm64 } from './pricing-attributes';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { minMonthlyGbSeconds: 100_000, ...LAMBDA_COMMON_DEFAULTS };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const lambdaArm64MigrationRule = defineRule({
  ruleId: 'lambda-arm64-migration',
  name: 'Lambda function eligible for arm64',
  description:
    'x86_64 Lambda function packaged as a .zip archive on a managed runtime that is available on arm64 ' +
    '(Graviton), with enough compute usage for the lower arm64 duration price to matter. Code and ' +
    'dependency compatibility cannot be verified, so confidence is LOW.',
  resourceType: 'LAMBDA_FUNCTION',
  category: 'OVERPROVISIONED',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    minMonthlyGbSeconds:
      'Monthly compute (configured memory GB x billed duration seconds, normalised to 30 days) must be at least this value (GB-seconds).',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage: LAMBDA_COVERAGE_DESCRIPTION,
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const a = resource.attributes;
    if (a.architecture !== 'x86_64') return NOT_DETECTED;
    if (a.packageType !== 'Zip') return NOT_DETECTED;
    if (!lambdaRuntimeSupportsArm64(a.runtime)) return NOT_DETECTED;

    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);
    const duration = monthlyDurationSeconds(resource, obs.observableDays, t.minCoverage);
    if (!duration.ok) return notEvaluated(duration.reason);
    const monthlyGbSeconds = gbSeconds(a.memoryMb, duration.seconds);
    if (monthlyGbSeconds < t.minMonthlyGbSeconds) return NOT_DETECTED;

    const label = resource.name ?? a.functionName;
    return {
      outcome: 'DETECTED',
      title: `Lambda function ${label} could run on arm64`,
      description:
        `Function ${a.functionName} (${a.runtime}, ${a.memoryMb} MB) runs on x86_64 and used about ` +
        `${round(monthlyGbSeconds, 0)} GB-seconds per month. arm64 (Graviton) duration is billed at a lower price; ` +
        'the runtime is available on arm64, but native dependencies and binaries must be verified before migrating.',
      confidence: 'LOW',
      riskLevel: 'MEDIUM',
      evidence: [
        {
          key: 'compute.monthlyGbSeconds',
          label: 'Compute per month (normalised to 30 days)',
          value: monthlyGbSeconds,
          unit: 'GB-s',
          threshold: `>= ${t.minMonthlyGbSeconds}`,
        },
        {
          key: 'duration.monthlySeconds',
          label: 'Billed duration per month (normalised to 30 days)',
          value: round(duration.seconds, 1),
          unit: 's',
        },
        { key: 'function.packageType', label: 'Package type', value: a.packageType, threshold: '= Zip' },
        observationEvidence(obs.observableDays, t.minObservationDays),
        ...lambdaFunctionEvidence(resource),
      ],
      suggestedAction: {
        type: 'MIGRATE_TO_ARM64',
        summary: 'Test the function on arm64 and switch its architecture if it behaves identically.',
        steps: [
          'Check the deployment package and layers for native binaries or architecture-specific dependencies; rebuild them for arm64 (aarch64).',
          'Deploy an arm64 copy of the function (or a new version behind an alias) in a non-production environment and run its tests.',
          'Compare duration and error rates between architectures; performance can differ by workload.',
          'Switch the architecture through your deployment pipeline or infrastructure-as-code, and shift traffic gradually with alias weights if possible.',
        ],
      },
      savingsRequest: {
        kind: 'LAMBDA_ARM64_MIGRATION',
        region: resource.region,
        memoryMb: a.memoryMb,
        monthlyDurationSeconds: round(duration.seconds, 3),
      },
    };
  },
});
