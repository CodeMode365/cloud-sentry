import { round } from '@cloudsentry/utilities';
import {
  BYTES_PER_GB,
  coverageEvidence,
  insufficientCoverageReason,
  normalizeTo30Days,
  observationEvidence,
  readMetric,
  requireObservation,
} from './metric-helpers';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { minGbPerMonth: 10, minObservationDays: 14, minCoverage: 0.8 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const cloudFrontCompressionDisabledRule = defineRule({
  ruleId: 'cloudfront-compression-disabled',
  name: 'CloudFront compression disabled',
  description:
    'Enabled CloudFront distribution that serves meaningful traffic with automatic compression turned off in ' +
    'its default cache behavior. Compressible content (HTML, CSS, JavaScript, JSON) is then sent uncompressed, ' +
    'increasing data transfer. The reduction depends on content type, so no savings are claimed.',
  resourceType: 'CLOUDFRONT_DISTRIBUTION',
  category: 'OVERPROVISIONED',
  version: 1,
  defaultSeverity: 'LOW',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    minGbPerMonth: 'BytesDownloaded, normalised to 30 days, must be at least this value (GB, 10^9 bytes).',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage:
      'Minimum fraction (0-1) of expected hourly datapoints required to conclude traffic is below the threshold (traffic at or above it is conclusive regardless of coverage).',
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const a = resource.attributes;
    if (!a.enabled) return NOT_DETECTED;
    if (a.defaultCacheBehaviorCompress === null) return notEvaluated('COMPRESSION_SETTING_UNKNOWN');
    if (a.defaultCacheBehaviorCompress) return NOT_DETECTED;
    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);

    const bytes = readMetric(resource, 'BytesDownloaded', 'Sum', 0);
    if (!bytes.ok) return notEvaluated(bytes.reason);
    if (bytes.stats.sum === null) return notEvaluated('METRIC_STATISTICS_INCOMPLETE');
    const gbPerMonth = normalizeTo30Days(bytes.stats.sum, obs.observableDays) / BYTES_PER_GB;
    const coverage = bytes.stats.coverage;
    if (gbPerMonth < t.minGbPerMonth) {
      // Missing hours could hide traffic: only conclude "below threshold" with adequate coverage.
      return coverage < t.minCoverage
        ? notEvaluated(insufficientCoverageReason('BytesDownloaded:Sum', coverage, t.minCoverage))
        : NOT_DETECTED;
    }

    const label = resource.name ?? a.distributionId;
    return {
      outcome: 'DETECTED',
      title: `Compression disabled on CloudFront distribution ${label}`,
      description:
        `Distribution ${a.distributionId} delivered about ${round(gbPerMonth, 1)} GB per month with automatic ` +
        'compression disabled in its default cache behavior. Enabling it typically reduces transfer for text-based ' +
        'content; already-compressed media (images, video, archives) is not affected.',
      confidence: 'LOW',
      riskLevel: 'LOW',
      evidence: [
        {
          key: 'distribution.compress',
          label: 'Default cache behavior compression',
          value: false,
          threshold: '= false',
        },
        {
          key: 'traffic.gbPerMonth',
          label: 'Data downloaded per month (normalised to 30 days)',
          value: round(gbPerMonth, 2),
          unit: 'GB',
          threshold: `>= ${t.minGbPerMonth}`,
        },
        observationEvidence(obs.observableDays, t.minObservationDays),
        coverageEvidence(coverage, t.minCoverage),
        { key: 'distribution.priceClass', label: 'Price class', value: a.priceClass },
        {
          key: 'scope.note',
          label: 'Scope',
          value:
            'Only the default cache behavior is checked; other cache behaviors have their own compression setting.',
        },
      ],
      suggestedAction: {
        type: 'ENABLE_COMPRESSION',
        summary: 'Enable automatic compression on the default cache behavior if the content is compressible.',
        steps: [
          'Check the content types served (HTML, CSS, JavaScript, JSON and SVG compress well; images and video do not).',
          'Make sure the cache policy includes gzip and Brotli in the cache key normalization so compressed objects are cached.',
          'Enable "Compress objects automatically" on the cache behavior through your infrastructure-as-code and deploy the distribution.',
          'Compare BytesDownloaded and cache hit ratio before and after the change.',
        ],
      },
      savingsRequest: null,
    };
  },
});
