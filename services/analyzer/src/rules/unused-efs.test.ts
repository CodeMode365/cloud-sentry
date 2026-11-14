import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { daysAgo, efsFileSystem, efsMetrics, GIB } from '../__fixtures__/resources';
import { unusedEfsRule as rule } from './unused-efs';

const ctx = (o = {}) => ctxFor(rule.defaultThresholds, o);

describe('unused-efs', () => {
  it('flags file systems without mount targets from metadata alone (HIGH confidence, HIGH risk)', () => {
    const out = rule.evaluate(efsFileSystem({ attributes: { numberOfMountTargets: 0 } }), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect([out.confidence, out.riskLevel]).toEqual(['HIGH', 'HIGH']);
    expect(out.suggestedAction.type).toBe('DELETE_FILE_SYSTEM');
    expect(out.savingsRequest).toEqual({
      kind: 'EFS_DELETE',
      region: 'us-east-1',
      standardGb: 200,
      infrequentAccessGb: 0,
      archiveGb: 0,
      oneZone: false,
    });
  });

  it('flags mounted file systems with zero connections and zero I/O (data present)', () => {
    const out = rule.evaluate(efsFileSystem({ utilization: efsMetrics() }), ctx());
    expect(out.outcome).toBe('DETECTED');
    expect(out.outcome === 'DETECTED' && out.confidence).toBe('HIGH');
  });

  it('treats any observed activity as conclusive, even if another metric is missing', () => {
    expect(rule.evaluate(efsFileSystem({ utilization: efsMetrics({ connMax: 2 }) }), ctx()).outcome).toBe(
      'NOT_DETECTED',
    );
    expect(
      rule.evaluate(efsFileSystem({ utilization: efsMetrics({ readBytes: 1_000 }) }), ctx()).outcome,
    ).toBe('NOT_DETECTED');
    expect(
      rule.evaluate(
        efsFileSystem({ utilization: efsMetrics({ connMax: null, writeBytes: 5, coverage: 0.1 }) }),
        ctx(),
      ).outcome,
    ).toBe('NOT_DETECTED');
  });

  it('treats NO_DATA as NOT_EVALUATED, never as zero activity', () => {
    const out = rule.evaluate(
      efsFileSystem({ utilization: efsMetrics({ connMax: null, readBytes: null, writeBytes: null }) }),
      ctx(),
    );
    expect(out).toEqual({ outcome: 'NOT_EVALUATED', reason: 'METRIC_NO_DATA: ClientConnections:Maximum' });
    const low = rule.evaluate(efsFileSystem({ utilization: efsMetrics({ coverage: 0.3 }) }), ctx());
    expect(low.outcome === 'NOT_EVALUATED' && low.reason).toMatch(/^INSUFFICIENT_METRIC_COVERAGE/);
  });

  it('applies the age gate (overridable) and falls back to the observed period when createdAt is null', () => {
    const young = efsFileSystem({ createdAt: daysAgo(3), attributes: { numberOfMountTargets: 0 } });
    expect(rule.evaluate(young, ctx()).outcome).toBe('NOT_DETECTED');
    expect(rule.evaluate(young, ctx({ minAgeDays: 1 })).outcome).toBe('DETECTED');
    expect(
      rule.evaluate(efsFileSystem({ createdAt: null, attributes: { numberOfMountTargets: 0 } }), ctx()),
    ).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'CREATION_TIME_UNKNOWN',
    });
    expect(rule.evaluate(efsFileSystem({ createdAt: null, utilization: efsMetrics() }), ctx()).outcome).toBe(
      'DETECTED',
    );
  });

  it('prices One Zone storage classes and all tiers', () => {
    const out = rule.evaluate(
      efsFileSystem({
        attributes: {
          numberOfMountTargets: 0,
          availabilityZoneName: 'us-east-1a',
          sizeBytesStandard: 10 * GIB,
          sizeBytesInfrequentAccess: 30 * GIB,
          sizeBytesArchive: 5 * GIB,
        },
      }),
      ctx(),
    );
    expect(out.outcome === 'DETECTED' && out.savingsRequest).toMatchObject({
      standardGb: 10,
      infrequentAccessGb: 30,
      archiveGb: 5,
      oneZone: true,
    });
  });

  it('handles lifecycle states', () => {
    expect(rule.evaluate(efsFileSystem({ state: 'creating' }), ctx()).outcome).toBe('NOT_EVALUATED');
    expect(rule.evaluate(efsFileSystem({ state: 'deleting' }), ctx()).outcome).toBe('NOT_DETECTED');
  });
});
