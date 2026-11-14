import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { daysAgo, ebsSnapshot, ebsVolume } from '../__fixtures__/resources';
import { unattachedEbsRule } from './unattached-ebs';

const ctx = (o = {}, all = []) => ctxFor(unattachedEbsRule.defaultThresholds, o, all);

describe('unattached-ebs', () => {
  it('detects an old available volume with HIGH confidence', () => {
    const out = unattachedEbsRule.evaluate(ebsVolume(), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.confidence).toBe('HIGH');
    expect(out.suggestedAction.type).toBe('DELETE_VOLUME');
    expect(out.savingsRequest).toEqual({
      kind: 'EBS_VOLUME_DELETE',
      region: 'us-east-1',
      volumeType: 'gp3',
      sizeGiB: 100,
    });
    expect(out.riskLevel).toBe('MEDIUM');
  });

  it('reports MEDIUM confidence between the minimum and high-confidence ages', () => {
    const out = unattachedEbsRule.evaluate(ebsVolume({ createdAt: daysAgo(10) }), ctx());
    expect(out.outcome === 'DETECTED' && out.confidence).toBe('MEDIUM');
  });

  it('ignores young volumes and in-use volumes', () => {
    expect(unattachedEbsRule.evaluate(ebsVolume({ createdAt: daysAgo(3) }), ctx()).outcome).toBe(
      'NOT_DETECTED',
    );
    expect(unattachedEbsRule.evaluate(ebsVolume({ state: 'in-use' }), ctx()).outcome).toBe('NOT_DETECTED');
  });

  it('is NOT_EVALUATED for transient states and unknown creation time', () => {
    expect(unattachedEbsRule.evaluate(ebsVolume({ state: 'creating' }), ctx()).outcome).toBe('NOT_EVALUATED');
    expect(unattachedEbsRule.evaluate(ebsVolume({ createdAt: null }), ctx())).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'CREATION_TIME_UNKNOWN',
    });
  });

  it('reports existing snapshots of the volume as evidence and lowers risk', () => {
    const vol = ebsVolume();
    const snap = ebsSnapshot({ attributes: { volumeId: vol.resourceId }, createdAt: daysAgo(5) });
    const out = unattachedEbsRule.evaluate(vol, ctx({}, [vol, snap] as never));
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.evidence.find((e) => e.key === 'snapshot.count')?.value).toBe(1);
    expect(out.riskLevel).toBe('LOW');
  });

  it('honours the minAgeDays override', () => {
    expect(
      unattachedEbsRule.evaluate(ebsVolume({ createdAt: daysAgo(10) }), ctx({ minAgeDays: 14 })).outcome,
    ).toBe('NOT_DETECTED');
  });
});
