import { round } from '@cloudsentry/utilities';
import {
  coverageConfidence,
  coverageEvidence,
  insufficientCoverageReason,
  observationEvidence,
  readMetric,
  requireObservation,
} from './metric-helpers';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { maxRequests: 100, minObservationDays: 14, minCoverage: 0.8 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const idleCloudFrontDistributionRule = defineRule({
  ruleId: 'idle-cloudfront-distribution',
  name: 'Idle CloudFront distribution',
  description:
    'Enabled CloudFront distribution that served almost no requests during the observation period. CloudFront ' +
    'has no fixed monthly fee, so no savings are claimed; idle distributions are still configuration to review.',
  resourceType: 'CLOUDFRONT_DISTRIBUTION',
  category: 'IDLE',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    maxRequests: 'Total Requests over the observation window must be below this value (requests).',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage:
      'Minimum fraction (0-1) of expected hourly datapoints required to conclude the distribution is idle (request totals at or above the threshold resolve the check regardless of coverage).',
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const a = resource.attributes;
    if (!a.enabled) return NOT_DETECTED;
    const obs = requireObservation(resource, t.minObservationDays);
    if (!obs.ok) return notEvaluated(obs.reason);

    const requests = readMetric(resource, 'Requests', 'Sum', 0);
    if (!requests.ok) return notEvaluated(requests.reason);
    const total = requests.stats.sum;
    if (total === null) return notEvaluated('METRIC_STATISTICS_INCOMPLETE');
    if (total >= t.maxRequests) return NOT_DETECTED;
    const coverage = requests.stats.coverage;
    if (coverage < t.minCoverage) {
      return notEvaluated(insufficientCoverageReason('Requests:Sum', coverage, t.minCoverage));
    }

    const label = resource.name ?? a.distributionId;
    return {
      outcome: 'DETECTED',
      title: `Idle CloudFront distribution ${label}`,
      description:
        `Distribution ${a.distributionId}${a.domainName ? ` (${a.domainName})` : ''} served ${round(total, 0)} requests ` +
        `over ${round(obs.observableDays, 0)} days. CloudFront charges per request and per byte, so an idle distribution ` +
        'costs little, but it may expose an unused origin or a forgotten DNS alias.',
      confidence: coverageConfidence(coverage, obs.observableDays),
      riskLevel: 'MEDIUM',
      evidence: [
        {
          key: 'requests.total',
          label: 'Requests in observation period',
          value: round(total, 0),
          threshold: `< ${t.maxRequests}`,
        },
        observationEvidence(obs.observableDays, t.minObservationDays),
        coverageEvidence(coverage, t.minCoverage),
        { key: 'distribution.enabled', label: 'Enabled', value: a.enabled },
        {
          key: 'distribution.aliases',
          label: 'Alternate domain names',
          value: a.aliases.length > 0 ? a.aliases.join(', ') : 'none',
        },
        { key: 'distribution.priceClass', label: 'Price class', value: a.priceClass },
        { key: 'distribution.origins', label: 'Origins', value: a.originCount },
        { key: 'distribution.webAcl', label: 'AWS WAF web ACL', value: a.webAclId ?? 'none' },
        {
          key: 'pricing.note',
          label: 'Savings',
          value:
            'Not estimated: CloudFront has no fixed monthly charge for an enabled distribution (an attached AWS WAF web ACL is billed separately).',
        },
      ],
      suggestedAction: {
        type: 'REVIEW_DISTRIBUTION',
        summary: 'Confirm the distribution is no longer needed, then disable it and delete it later.',
        steps: [
          'Check DNS records and applications that reference the distribution domain name or its alternate domain names.',
          'Check whether it is a standby or disaster-recovery distribution that is expected to be idle.',
          'Disable the distribution first and wait to confirm nothing breaks; disabling is reversible.',
          'Delete the disabled distribution, and review its origins (S3 buckets, load balancers) and any AWS WAF web ACL for clean-up.',
        ],
      },
      savingsRequest: null,
    };
  },
});
