import type { EvidenceItem } from '@cloudsentry/shared-types';
import { round } from '@cloudsentry/utilities';
import { BYTES_PER_GIB } from './metric-helpers';
import {
  NOT_DETECTED,
  notEvaluated,
  type NotDetectedOutcome,
  type NotEvaluatedOutcome,
  type ResourceOf,
} from './types';

export type EfsFileSystem = ResourceOf<'EFS_FILE_SYSTEM'>;

/** `available` file systems are evaluated; deleting/deleted are NOT_DETECTED; other states are transient. */
export function efsStateGate(resource: EfsFileSystem): NotDetectedOutcome | NotEvaluatedOutcome | null {
  if (resource.state === 'available') return null;
  if (resource.state === 'deleting' || resource.state === 'deleted') return NOT_DETECTED;
  return notEvaluated(`TRANSIENT_STATE: ${resource.state}`);
}

export function gib(bytes: number): number {
  return round(Math.max(0, bytes) / BYTES_PER_GIB, 3);
}

export function isOneZone(resource: EfsFileSystem): boolean {
  return resource.attributes.availabilityZoneName !== null;
}

export function efsSizeEvidence(resource: EfsFileSystem): EvidenceItem[] {
  const a = resource.attributes;
  return [
    { key: 'size.totalGib', label: 'Metered size', value: gib(a.sizeBytesTotal), unit: 'GiB' },
    { key: 'size.standardGib', label: 'Standard storage', value: gib(a.sizeBytesStandard), unit: 'GiB' },
    {
      key: 'size.iaGib',
      label: 'Infrequent Access storage',
      value: gib(a.sizeBytesInfrequentAccess),
      unit: 'GiB',
    },
    { key: 'size.archiveGib', label: 'Archive storage', value: gib(a.sizeBytesArchive), unit: 'GiB' },
    {
      key: 'fs.storageClass',
      label: 'Availability',
      value: isOneZone(resource) ? `One Zone (${a.availabilityZoneName})` : 'Regional',
    },
    { key: 'fs.throughputMode', label: 'Throughput mode', value: a.throughputMode },
  ];
}
