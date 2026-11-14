import type { ConfidenceLevel, EvidenceItem } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { efsSizeEvidence, efsStateGate, gib, isOneZone } from './efs-shared';
import {
  ageEvidence,
  coverageConfidence,
  coverageEvidence,
  insufficientCoverageReason,
  observationEvidence,
  readMetric,
  requireObservation,
  resourceAge,
} from './metric-helpers';
import { defineRule, NOT_DETECTED, notEvaluated } from './types';

const DEFAULTS = { minAgeDays: 7, minObservationDays: 14, minCoverage: 0.8 };
type Thresholds = Record<keyof typeof DEFAULTS, number>;

const ACTIVITY_METRICS = [
  ['ClientConnections', 'Maximum'],
  ['DataReadIOBytes', 'Sum'],
  ['DataWriteIOBytes', 'Sum'],
] as const;

export const unusedEfsRule = defineRule({
  ruleId: 'unused-efs',
  name: 'Unused EFS file system',
  description:
    'Available EFS file system with no mount targets, or with no client connections and no read or write ' +
    'I/O for the whole observation period. Storage is billed whether or not the file system is used.',
  resourceType: 'EFS_FILE_SYSTEM',
  category: 'UNUSED',
  version: 1,
  defaultSeverity: 'MEDIUM',
  defaultThresholds: DEFAULTS,
  thresholdDescriptions: {
    minAgeDays: 'File systems younger than this (days since creation) are not flagged.',
    minObservationDays: 'Minimum days of history required to evaluate file systems that have mount targets.',
    minCoverage:
      'Minimum fraction (0-1) of expected hourly datapoints required to conclude there was no activity (observed activity resolves the check regardless of coverage).',
  },
  evaluate(resource, { thresholds, now }) {
    const t = thresholds as Thresholds;
    const gate = efsStateGate(resource);
    if (gate) return gate;
    const a = resource.attributes;
    const age = resourceAge(resource, now);
    if (age === null) return notEvaluated('CREATION_TIME_UNKNOWN');
    if (age.days < t.minAgeDays) return NOT_DETECTED;

    const evidence: EvidenceItem[] = [
      {
        key: 'fs.mountTargets',
        label: 'Mount targets',
        value: a.numberOfMountTargets,
        ...(a.numberOfMountTargets === 0 ? { threshold: '= 0' } : {}),
      },
      ageEvidence('fs.ageDays', age, t.minAgeDays),
    ];
    let confidence: ConfidenceLevel = 'HIGH';
    let basis: string;

    if (a.numberOfMountTargets === 0) {
      basis = 'has no mount targets, so no client can mount it';
    } else {
      const obs = requireObservation(resource, t.minObservationDays);
      if (!obs.ok) return notEvaluated(obs.reason);
      const reads = ACTIVITY_METRICS.map(([metric, stat]) => ({
        key: `${metric}:${stat}`,
        metric,
        stat,
        read: readMetric(resource, metric, stat, 0),
      }));
      // Observed activity on any metric is conclusive, even when another metric is missing.
      for (const r of reads) {
        if (!r.read.ok) continue;
        const value = r.stat === 'Maximum' ? r.read.stats.maximum : r.read.stats.sum;
        if (value !== null && value > 0) return NOT_DETECTED;
      }
      let coverage = 1;
      for (const r of reads) {
        if (!r.read.ok) return notEvaluated(r.read.reason);
        const value = r.stat === 'Maximum' ? r.read.stats.maximum : r.read.stats.sum;
        if (value === null) return notEvaluated(`METRIC_STATISTICS_INCOMPLETE: ${r.key}`);
        if (r.read.stats.coverage < t.minCoverage) {
          return notEvaluated(insufficientCoverageReason(r.key, r.read.stats.coverage, t.minCoverage));
        }
        coverage = Math.min(coverage, r.read.stats.coverage);
      }
      confidence = coverageConfidence(coverage, obs.observableDays);
      basis = `had no client connections and no read or write I/O over ${round(obs.observableDays, 0)} days`;
      evidence.push(
        { key: 'connections.maximum', label: 'Maximum client connections', value: 0, threshold: '= 0' },
        { key: 'io.bytes', label: 'Data read + written', value: 0, unit: 'bytes', threshold: '= 0' },
        observationEvidence(obs.observableDays, t.minObservationDays),
        coverageEvidence(coverage, t.minCoverage),
      );
    }
    evidence.push(...efsSizeEvidence(resource));
    if (a.throughputMode === 'provisioned' && a.provisionedThroughputMibps) {
      evidence.push({
        key: 'fs.provisionedThroughput',
        label: 'Provisioned throughput (billed separately, not included in the estimate)',
        value: a.provisionedThroughputMibps,
        unit: 'MiB/s',
      });
    }

    const label = resource.name ?? a.fileSystemId;
    return {
      outcome: 'DETECTED',
      title: `Unused EFS file system ${label}`,
      description:
        `File system ${a.fileSystemId} (${gib(a.sizeBytesTotal)} GiB) ${basis}. ` +
        'Its stored data is still billed every month.',
      confidence,
      riskLevel: 'HIGH',
      evidence,
      suggestedAction: {
        type: 'DELETE_FILE_SYSTEM',
        summary: 'Confirm the data is no longer needed, back it up, then delete the file system.',
        steps: [
          'Identify the owner from tags and confirm no workload (including infrequent jobs or disaster-recovery hosts) mounts it.',
          'Back up the file system with AWS Backup, or copy the data elsewhere, if it may be needed later.',
          'Delete its mount targets and access points, then delete the file system. Deletion cannot be undone.',
        ],
      },
      savingsRequest: {
        kind: 'EFS_DELETE',
        region: resource.region,
        standardGb: gib(a.sizeBytesStandard),
        infrequentAccessGb: gib(a.sizeBytesInfrequentAccess),
        archiveGb: gib(a.sizeBytesArchive),
        oneZone: isOneZone(resource),
      },
    };
  },
});
