import type {
  ConfidenceLevel,
  EvidenceItem,
  SavingsRequest,
  SuggestedAction,
} from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { minCoverageOf, pct, readMetric, readMetrics } from './metric-helpers';
import { nextSmallerRdsClass, rdsPriceListEngine } from './pricing-attributes';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const GIB = 1024 ** 3;

const DEFAULTS = {
  cpuAverageMaxPercent: 10,
  cpuMaximumMaxPercent: 40,
  connectionsAverageMax: 5,
  iopsAverageMax: 50,
  minObservationDays: 14,
  minCoverage: 0.8,
};
type Thresholds = Record<keyof typeof DEFAULTS, number>;

export const underutilizedRdsRule = defineRule({
  ruleId: 'underutilized-rds',
  name: 'Underutilized RDS instance',
  description:
    'RDS DB instance with consistently low CPU, few connections and low I/O. Databases with no connections ' +
    'for the whole period are flagged as unused; others are flagged for rightsizing.',
  resourceType: 'RDS_INSTANCE',
  category: 'OVERPROVISIONED',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    cpuAverageMaxPercent: 'Average CPUUtilization must be below this value (percent).',
    cpuMaximumMaxPercent: 'Maximum hourly CPUUtilization must be below this value (percent).',
    connectionsAverageMax: 'Average DatabaseConnections must be below this value.',
    iopsAverageMax: 'Average ReadIOPS + WriteIOPS must be below this value (operations per second).',
    minObservationDays: 'Minimum days of history required to evaluate.',
    minCoverage: 'Minimum fraction (0-1) of expected hourly datapoints that must be present for each metric.',
  },
  evaluate(resource, { thresholds }) {
    const t = thresholds as Thresholds;
    const attrs = resource.attributes;
    if (resource.state === 'stopped' || resource.state === 'deleting') return NOT_DETECTED;
    if (resource.state !== 'available') return notEvaluated(`TRANSIENT_STATE: ${resource.state}`);
    if (attrs.dbClusterIdentifier)
      return notEvaluated('CLUSTER_MEMBER: Aurora/cluster instances are not evaluated');

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
        connAvg: ['DatabaseConnections', 'Average'],
        connMax: ['DatabaseConnections', 'Maximum'],
        readIops: ['ReadIOPS', 'Average'],
        writeIops: ['WriteIOPS', 'Average'],
      },
      t.minCoverage,
    );
    if (!reads.ok) return notEvaluated(reads.reason);
    const v = reads.values;
    const cpuAverage = v.cpuAvg.stats.average;
    const cpuMaximum = v.cpuMax.stats.maximum;
    const connAverage = v.connAvg.stats.average;
    const connMaximum = v.connMax.stats.maximum;
    const readAvg = v.readIops.stats.average;
    const writeAvg = v.writeIops.stats.average;
    if ([cpuAverage, cpuMaximum, connAverage, connMaximum, readAvg, writeAvg].some((x) => x === null)) {
      return notEvaluated('METRIC_STATISTICS_INCOMPLETE');
    }
    const iops = (readAvg as number) + (writeAvg as number);
    const low =
      (cpuAverage as number) < t.cpuAverageMaxPercent &&
      (cpuMaximum as number) < t.cpuMaximumMaxPercent &&
      (connAverage as number) < t.connectionsAverageMax &&
      iops < t.iopsAverageMax;
    if (!low) return NOT_DETECTED;

    const unused = connMaximum === 0;
    const coverage = minCoverageOf(v.cpuAvg, v.cpuMax, v.connAvg, v.connMax, v.readIops, v.writeIops);
    const confidence: ConfidenceLevel = coverage >= 0.95 && observable >= 28 ? 'HIGH' : 'MEDIUM';
    const engine = rdsPriceListEngine(attrs.engine);
    const targetClass = unused ? null : nextSmallerRdsClass(attrs.instanceClass);

    const evidence: EvidenceItem[] = [
      {
        key: 'cpu.average',
        label: 'Average CPU utilization',
        value: pct(cpuAverage as number),
        unit: '%',
        threshold: `< ${t.cpuAverageMaxPercent}`,
      },
      {
        key: 'cpu.maximum',
        label: 'Maximum hourly CPU utilization',
        value: pct(cpuMaximum as number),
        unit: '%',
        threshold: `< ${t.cpuMaximumMaxPercent}`,
      },
      {
        key: 'connections.average',
        label: 'Average connections',
        value: round(connAverage as number, 2),
        threshold: `< ${t.connectionsAverageMax}`,
      },
      { key: 'connections.maximum', label: 'Maximum connections', value: round(connMaximum as number, 0) },
      {
        key: 'iops.average',
        label: 'Average read + write IOPS',
        value: round(iops, 2),
        threshold: `< ${t.iopsAverageMax}`,
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
      { key: 'db.instanceClass', label: 'Instance class', value: attrs.instanceClass },
      { key: 'db.engine', label: 'Engine', value: attrs.engine },
      { key: 'db.multiAz', label: 'Multi-AZ', value: attrs.multiAz },
    ];
    if (attrs.multiAz) {
      evidence.push({
        key: 'db.multiAzNote',
        label: 'Multi-AZ consideration',
        value:
          'Multi-AZ doubles instance cost; for non-production databases a Single-AZ deployment may be sufficient.',
      });
    }
    const freeStorage = readMetric(resource, 'FreeStorageSpace', 'Minimum', 0);
    if (freeStorage.ok && freeStorage.stats.minimum !== null && attrs.allocatedStorageGiB > 0) {
      const freeGiB = freeStorage.stats.minimum / GIB;
      evidence.push({
        key: 'storage.minFreeGiB',
        label: 'Minimum free storage',
        value: round(freeGiB, 1),
        unit: `GiB of ${attrs.allocatedStorageGiB} GiB`,
      });
      if (freeGiB / attrs.allocatedStorageGiB > 0.7) {
        evidence.push({
          key: 'storage.note',
          label: 'Storage',
          value:
            'More than 70% of storage is free. RDS storage cannot be reduced in place; shrinking requires migration.',
        });
      }
    }

    let savingsRequest: SavingsRequest | null;
    let suggestedAction: SuggestedAction;
    if (unused) {
      savingsRequest = {
        kind: 'RDS_STOP',
        region: resource.region,
        databaseEngine: engine,
        instanceClass: attrs.instanceClass,
        multiAz: attrs.multiAz,
      };
      suggestedAction = {
        type: 'STOP_DATABASE',
        summary:
          'No connections were observed for the whole period. Confirm it is unused, take a final snapshot, then stop or delete it.',
        steps: [
          'Confirm with the owner that no application, report or scheduled job uses this database.',
          'Take a manual snapshot (final backup).',
          'Stop the instance for short-term savings (AWS restarts stopped instances automatically after 7 days), or delete it after the snapshot is verified.',
        ],
      };
    } else {
      savingsRequest = {
        kind: 'RDS_RIGHTSIZE',
        region: resource.region,
        databaseEngine: engine,
        currentClass: attrs.instanceClass,
        targetClass,
        multiAz: attrs.multiAz,
      };
      suggestedAction = {
        type: 'RIGHTSIZE_DATABASE',
        summary: targetClass
          ? `Consider downsizing from ${attrs.instanceClass} to ${targetClass} after validating memory and peak load.`
          : `Utilization is low, but no smaller class in the ${attrs.instanceClass} family was identified; review the instance family.`,
        steps: [
          'Review FreeableMemory, peak CPU and connection patterns, including month-end or batch workloads.',
          targetClass
            ? `Test the workload on ${targetClass} (for example on a restored snapshot) before changing production.`
            : 'Evaluate a smaller instance family (for example burstable classes) for this workload.',
          'Apply the change during a maintenance window; modifying the instance class causes downtime for Single-AZ deployments.',
        ],
      };
    }
    if (!engine) {
      evidence.push({
        key: 'pricing.unsupported',
        label: 'Pricing not available',
        value: `Engine "${attrs.engine}" is not supported by the savings engine (licensed engines vary by edition and license model)`,
      });
    }

    const label = resource.name ?? resource.resourceId;
    return {
      outcome: 'DETECTED',
      title: unused ? `Unused RDS instance ${label}` : `Underutilized RDS instance ${label}`,
      description:
        `DB instance ${resource.resourceId} (${attrs.instanceClass}, ${attrs.engine}${attrs.multiAz ? ', Multi-AZ' : ''}) ` +
        `averaged ${pct(cpuAverage as number)}% CPU (peak ${pct(cpuMaximum as number)}%), ` +
        `${round(connAverage as number, 2)} connections (peak ${round(connMaximum as number, 0)}) and ` +
        `${round(iops, 1)} IOPS over ${round(observable, 0)} days.`,
      severity: unused ? 'HIGH' : undefined,
      confidence,
      riskLevel: unused ? 'HIGH' : 'MEDIUM',
      evidence,
      suggestedAction,
      savingsRequest,
    };
  },
});
