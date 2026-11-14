import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { efsFileSystem, GIB } from '../__fixtures__/resources';
import { efsMissingLifecycleRule as rule } from './efs-missing-lifecycle';

const ctx = (o = {}) => ctxFor(rule.defaultThresholds, o);

describe('efs-missing-lifecycle', () => {
  it('flags large Standard storage without an IA transition (LOW confidence, upper-bound savings)', () => {
    const out = rule.evaluate(efsFileSystem(), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.confidence).toBe('LOW');
    expect(out.suggestedAction.type).toBe('ENABLE_STORAGE_LIFECYCLE');
    expect(out.suggestedAction.steps.join(' ')).toMatch(/AFTER_30_DAYS/);
    expect(out.savingsRequest).toEqual({
      kind: 'EFS_LIFECYCLE_TO_IA',
      region: 'us-east-1',
      standardGb: 200,
      oneZone: false,
    });
  });

  it('is NOT_EVALUATED when the lifecycle configuration is unknown', () => {
    const out = rule.evaluate(efsFileSystem({ attributes: { lifecycle: null } }), ctx());
    expect(out.outcome === 'NOT_EVALUATED' && out.reason).toMatch(/^LIFECYCLE_CONFIGURATION_UNKNOWN/);
  });

  it('is NOT_DETECTED with an IA transition or little Standard data, and honours minStandardGb', () => {
    const withIa = efsFileSystem({
      attributes: {
        lifecycle: { transitionToIA: 'AFTER_30_DAYS', transitionToArchive: null, transitionToPrimary: null },
      },
    });
    expect(rule.evaluate(withIa, ctx()).outcome).toBe('NOT_DETECTED');
    const small = efsFileSystem({ attributes: { sizeBytesStandard: 10 * GIB } });
    expect(rule.evaluate(small, ctx()).outcome).toBe('NOT_DETECTED');
    expect(rule.evaluate(small, ctx({ minStandardGb: 5 })).outcome).toBe('DETECTED');
  });
});
