import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { rdsInstance, rdsMetrics, series, utilizationOf } from '../__fixtures__/resources';
import { underutilizedRdsRule } from './underutilized-rds';

const ctx = (o = {}) => ctxFor(underutilizedRdsRule.defaultThresholds, o);

describe('underutilized-rds', () => {
  it('recommends rightsizing to the next smaller class in the family', () => {
    const out = underutilizedRdsRule.evaluate(rdsInstance({ utilization: rdsMetrics() }), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.suggestedAction.type).toBe('RIGHTSIZE_DATABASE');
    expect(out.savingsRequest).toEqual({
      kind: 'RDS_RIGHTSIZE',
      region: 'us-east-1',
      databaseEngine: 'PostgreSQL',
      currentClass: 'db.m5.2xlarge',
      targetClass: 'db.m5.xlarge',
      multiAz: false,
    });
    expect(out.severity).toBeUndefined();
    expect(out.evidence.some((e) => e.key === 'storage.note')).toBe(true);
  });

  it('flags databases with zero connections as unused (stop) with HIGH severity', () => {
    const out = underutilizedRdsRule.evaluate(
      rdsInstance({ utilization: rdsMetrics({ connAvg: 0, connMax: 0 }), attributes: { multiAz: true } }),
      ctx(),
    );
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.suggestedAction.type).toBe('STOP_DATABASE');
    expect(out.severity).toBe('HIGH');
    expect(out.riskLevel).toBe('HIGH');
    expect(out.savingsRequest).toMatchObject({
      kind: 'RDS_STOP',
      multiAz: true,
      instanceClass: 'db.m5.2xlarge',
    });
    expect(out.evidence.some((e) => e.key === 'db.multiAzNote')).toBe(true);
  });

  it('does not flag busy databases', () => {
    expect(
      underutilizedRdsRule.evaluate(rdsInstance({ utilization: rdsMetrics({ cpuMax: 85 }) }), ctx()).outcome,
    ).toBe('NOT_DETECTED');
    expect(
      underutilizedRdsRule.evaluate(rdsInstance({ utilization: rdsMetrics({ connAvg: 30 }) }), ctx()).outcome,
    ).toBe('NOT_DETECTED');
    expect(
      underutilizedRdsRule.evaluate(rdsInstance({ utilization: rdsMetrics({ readIops: 400 }) }), ctx())
        .outcome,
    ).toBe('NOT_DETECTED');
  });

  it('does not evaluate cluster members, transient states or missing metrics', () => {
    const member = rdsInstance({
      utilization: rdsMetrics(),
      attributes: { dbClusterIdentifier: 'aurora-1' },
    });
    expect(underutilizedRdsRule.evaluate(member, ctx()).outcome).toBe('NOT_EVALUATED');
    expect(underutilizedRdsRule.evaluate(rdsInstance({ state: 'modifying' }), ctx()).outcome).toBe(
      'NOT_EVALUATED',
    );
    const noConn = utilizationOf([
      series('AWS/RDS', 'CPUUtilization', 'Average', { average: 1 }),
      series('AWS/RDS', 'CPUUtilization', 'Maximum', { maximum: 2 }),
      series('AWS/RDS', 'DatabaseConnections', 'Average', { availability: 'ERROR' }),
    ]);
    const out = underutilizedRdsRule.evaluate(rdsInstance({ utilization: noConn }), ctx());
    expect(out).toEqual({ outcome: 'NOT_EVALUATED', reason: 'METRIC_ERROR: DatabaseConnections:Average' });
  });

  it('returns NOT_DETECTED for stopped databases', () => {
    expect(underutilizedRdsRule.evaluate(rdsInstance({ state: 'stopped' }), ctx()).outcome).toBe(
      'NOT_DETECTED',
    );
  });

  it('has no rightsizing target for the smallest classes and flags unsupported engines', () => {
    const out = underutilizedRdsRule.evaluate(
      rdsInstance({
        utilization: rdsMetrics(),
        attributes: { instanceClass: 'db.r6g.large', engine: 'oracle-ee' },
      }),
      ctx(),
    );
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.savingsRequest).toMatchObject({ targetClass: null, databaseEngine: null });
    expect(out.evidence.some((e) => e.key === 'pricing.unsupported')).toBe(true);
  });
});
