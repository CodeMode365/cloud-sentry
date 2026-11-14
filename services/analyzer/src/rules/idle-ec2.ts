import type { ConfidenceLevel, EvidenceItem, SavingsRequest } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { averagePerDay, BYTES_PER_MB, minCoverageOf, pct, readMetrics } from './metric-helpers';
import { ec2PriceListAttributes, ec2PriceListTenancy } from './pricing-attributes';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const NOT_RUNNING_STATES = new Set(['stopped', 'stopping', 'terminated', 'shutting-down']);

const DEFAULTS = {
  cpuAverageMaxPercent: 5,
  cpuMaximumMaxPercent: 10,
  networkMaxMbPerDay: 5,
  minObservationDays: 14,
  minCoverage: 0.8,
};
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const idleEc2Rule = defineRule({
  ruleId: 'idle-ec2',
  name: 'Idle EC2 instance',
  description:
    'Running EC2 instance whose CPU stayed low on average AND at peak, with low network traffic, over the ' +
    'observation period. Low average CPU alone is never sufficient.',
  resourceType: 'EC2_INSTANCE',
  category: 'IDLE',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    cpuAverageMaxPercent: 'Average CPUUtilization must be below this value (percent).',
    cpuMaximumMaxPercent: 'Maximum hourly CPUUtilization must be below this value (percent).',
    networkMaxMbPerDay: 'Average NetworkIn + NetworkOut per day must be below this value (MB, 10^6 bytes).',
    minObservationDays: 'Minimum days of history (bounded by launch time and lookback) required to evaluate.',
    minCoverage: 'Minimum fraction (0-1) of expected hourly datapoints that must be present for each metric.',
  },
  evaluate(resource, { thresholds }) {
    if (NOT_RUNNING_STATES.has(resource.state)) return NOT_DETECTED;
    if (resource.state !== 'running') return notEvaluated(`TRANSIENT_STATE: ${resource.state}`);

    const t = thresholds as Thresholds;
    const observable = resource.utilization?.observableDays ?? null;
    if (observable === null) return notEvaluated('METRICS_NOT_COLLECTED');
    if (observable < t.minObservationDays) {
      return notEvaluated(
        `INSUFFICIENT_OBSERVATION_PERIOD: ${round(observable, 1)} < ${t.minObservationDays} days`,
      );
    }

    const reads = readMetrics(
      resource,
      {
        cpuAvg: ['CPUUtilization', 'Average'],
        cpuMax: ['CPUUtilization', 'Maximum'],
        netIn: ['NetworkIn', 'Sum'],
        netOut: ['NetworkOut', 'Sum'],
      },
      t.minCoverage,
    );
    if (!reads.ok) return notEvaluated(reads.reason);
    const { cpuAvg, cpuMax, netIn, netOut } = reads.values;

    const cpuAverage = cpuAvg.stats.average;
    const cpuMaximum = cpuMax.stats.maximum;
    const inPerDay = averagePerDay(netIn);
    const outPerDay = averagePerDay(netOut);
    if (cpuAverage === null || cpuMaximum === null || inPerDay === null || outPerDay === null) {
      return notEvaluated('METRIC_STATISTICS_INCOMPLETE');
    }
    const networkMbPerDay = (inPerDay + outPerDay) / BYTES_PER_MB;

    const idle =
      cpuAverage < t.cpuAverageMaxPercent &&
      cpuMaximum < t.cpuMaximumMaxPercent &&
      networkMbPerDay < t.networkMaxMbPerDay;
    if (!idle) return NOT_DETECTED;

    const coverage = minCoverageOf(cpuAvg, cpuMax, netIn, netOut);
    const confidence: ConfidenceLevel = coverage >= 0.95 && observable >= 28 ? 'HIGH' : 'MEDIUM';
    const attrs = resource.attributes;

    const evidence: EvidenceItem[] = [
      {
        key: 'cpu.average',
        label: 'Average CPU utilization',
        value: pct(cpuAverage),
        unit: '%',
        threshold: `< ${t.cpuAverageMaxPercent}`,
      },
      {
        key: 'cpu.maximum',
        label: 'Maximum hourly CPU utilization',
        value: pct(cpuMaximum),
        unit: '%',
        threshold: `< ${t.cpuMaximumMaxPercent}`,
      },
      ...(cpuAvg.stats.p95 !== null
        ? [{ key: 'cpu.p95', label: 'p95 of hourly average CPU', value: pct(cpuAvg.stats.p95), unit: '%' }]
        : []),
      {
        key: 'network.mbPerDay',
        label: 'Average network in+out per day',
        value: round(networkMbPerDay, 3),
        unit: 'MB',
        threshold: `< ${t.networkMaxMbPerDay}`,
      },
      {
        key: 'observation.days',
        label: 'Observation period',
        value: round(observable, 1),
        unit: 'days',
        threshold: `>= ${t.minObservationDays}`,
      },
      {
        key: 'metrics.coverage',
        label: 'Lowest metric coverage',
        value: round(coverage * 100, 1),
        unit: '%',
        threshold: `>= ${t.minCoverage * 100}`,
      },
      { key: 'instance.type', label: 'Instance type', value: attrs.instanceType },
      { key: 'instance.platform', label: 'Platform', value: attrs.platformDetails ?? 'Linux/UNIX' },
    ];

    let savingsRequest: SavingsRequest | null = null;
    const priceAttrs = ec2PriceListAttributes(attrs.platformDetails);
    const tenancy = ec2PriceListTenancy(attrs.tenancy);
    if (!priceAttrs) {
      evidence.push({
        key: 'pricing.unsupported',
        label: 'Pricing not available',
        value: `Platform "${attrs.platformDetails ?? 'unknown'}" is not supported by the savings engine`,
      });
    } else if (tenancy === null || tenancy === 'Host') {
      evidence.push({
        key: 'pricing.unsupported',
        label: 'Pricing not available',
        value:
          tenancy === 'Host'
            ? 'Instances on Dedicated Hosts are billed per host; stopping one instance does not reduce the host charge'
            : `Tenancy "${attrs.tenancy}" is not supported by the savings engine`,
      });
    } else {
      savingsRequest = {
        kind: 'EC2_INSTANCE_STOP',
        region: resource.region,
        instanceType: attrs.instanceType,
        operatingSystem: priceAttrs.operatingSystem,
        tenancy,
        preInstalledSw: priceAttrs.preInstalledSw,
        licenseModel: priceAttrs.licenseModel,
        nonOnDemandLifecycle: attrs.instanceLifecycle,
      };
    }

    const label = resource.name ?? resource.resourceId;
    return {
      outcome: 'DETECTED',
      title: `Idle EC2 instance ${label}`,
      description:
        `Instance ${resource.resourceId} (${attrs.instanceType}) averaged ${pct(cpuAverage)}% CPU with a peak of ` +
        `${pct(cpuMaximum)}% and about ${round(networkMbPerDay, 2)} MB/day of network traffic over ` +
        `${round(observable, 0)} days.`,
      confidence,
      riskLevel: 'MEDIUM',
      evidence,
      suggestedAction: {
        type: 'STOP_INSTANCE',
        summary:
          'Confirm with the owner that the instance is unused, then stop it (or terminate it after taking an AMI backup).',
        steps: [
          'Identify the owner from tags and confirm the instance is not needed (batch jobs, standby, or scheduled workloads may look idle).',
          'Check for dependencies such as Elastic IPs, DNS records, target groups, or scheduled tasks.',
          'Stop the instance; attached EBS volumes continue to be billed while it is stopped.',
          'If it remains unneeded, create an AMI or snapshots and terminate it; otherwise consider a smaller instance type.',
        ],
      },
      savingsRequest,
    };
  },
});
