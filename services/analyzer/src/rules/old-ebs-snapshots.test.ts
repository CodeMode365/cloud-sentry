import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { daysAgo, ebsSnapshot } from '../__fixtures__/resources';
import { oldEbsSnapshotsRule } from './old-ebs-snapshots';

const ctx = (o = {}) => ctxFor(oldEbsSnapshotsRule.defaultThresholds, o);

describe('old-ebs-snapshots', () => {
  it('flags snapshots beyond retention with LOW confidence when the source volume exists', () => {
    const out = oldEbsSnapshotsRule.evaluate(ebsSnapshot(), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.confidence).toBe('LOW');
    expect(out.riskLevel).toBe('MEDIUM');
    expect(out.savingsRequest).toEqual({ kind: 'EBS_SNAPSHOT_DELETE', region: 'us-east-1', sizeGiB: 50 });
  });

  it('raises risk (possible only copy) and confidence when the source volume is gone and very old', () => {
    const out = oldEbsSnapshotsRule.evaluate(
      ebsSnapshot({ attributes: { sourceVolumeExists: false } }),
      ctx(),
    );
    expect(out.outcome === 'DETECTED' && [out.confidence, out.riskLevel]).toEqual(['MEDIUM', 'HIGH']);
  });

  it('ignores snapshots within retention', () => {
    expect(oldEbsSnapshotsRule.evaluate(ebsSnapshot({ createdAt: daysAgo(30) }), ctx()).outcome).toBe(
      'NOT_DETECTED',
    );
    expect(oldEbsSnapshotsRule.evaluate(ebsSnapshot(), ctx({ retentionDays: 500 })).outcome).toBe(
      'NOT_DETECTED',
    );
  });

  it.each([
    [{ tags: { 'aws:backup:source-resource': 'arn' } }, 'MANAGED_BY_AWS_BACKUP'],
    [
      { attributes: { description: 'This snapshot is created by the AWS Backup service.' } },
      'MANAGED_BY_AWS_BACKUP',
    ],
    [{ tags: { 'aws:dlm:lifecycle-policy-id': 'policy-1' } }, 'MANAGED_BY_DLM'],
    [{ attributes: { description: 'Created by CreateImage(i-123) for ami-123' } }, 'AMI_BACKING_SNAPSHOT'],
    [{ state: 'pending' }, 'SNAPSHOT_NOT_COMPLETED'],
  ])('does not evaluate managed or incomplete snapshots (%#)', (overrides, reason) => {
    const out = oldEbsSnapshotsRule.evaluate(ebsSnapshot(overrides as never), ctx());
    expect(out.outcome).toBe('NOT_EVALUATED');
    expect(out.outcome === 'NOT_EVALUATED' && out.reason.startsWith(reason)).toBe(true);
  });

  it('omits savings for archive-tier snapshots', () => {
    const out = oldEbsSnapshotsRule.evaluate(ebsSnapshot({ attributes: { storageTier: 'archive' } }), ctx());
    expect(out.outcome === 'DETECTED' && out.savingsRequest).toBeNull();
  });
});
