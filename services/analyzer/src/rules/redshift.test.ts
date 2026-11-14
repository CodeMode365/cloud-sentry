import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { redshiftCluster, redshiftMetrics } from '../__fixtures__/resources';
import { idleRedshiftClusterRule as idleRule } from './idle-redshift-cluster';
import { redshiftPauseScheduleRule as scheduleRule } from './redshift-pause-schedule';

const idleCtx = (o = {}) => ctxFor(idleRule.defaultThresholds, o);
const scheduleCtx = (o = {}) => ctxFor(scheduleRule.defaultThresholds, o);

describe('idle-redshift-cluster', () => {
  it('flags clusters with zero connections in every hour (pausableFraction 1)', () => {
    const out = idleRule.evaluate(
      redshiftCluster({ utilization: redshiftMetrics({ connMax: 0 }) }),
      idleCtx(),
    );
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.suggestedAction.type).toBe('PAUSE_CLUSTER');
    expect(out.confidence).toBe('HIGH');
    expect(out.savingsRequest).toEqual({
      kind: 'REDSHIFT_PAUSE',
      region: 'us-east-1',
      nodeType: 'ra3.xlplus',
      numberOfNodes: 2,
      pausableFraction: 1,
    });
    expect(out.evidence.some((e) => e.key === 'pricing.managedStorage')).toBe(true);
  });

  it('treats NO_DATA as NOT_EVALUATED and any connection as NOT_DETECTED', () => {
    expect(
      idleRule.evaluate(redshiftCluster({ utilization: redshiftMetrics({ connMax: null }) }), idleCtx()),
    ).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRIC_NO_DATA: DatabaseConnections:Maximum',
    });
    expect(
      idleRule.evaluate(
        redshiftCluster({ utilization: redshiftMetrics({ connMax: 3, coverage: 0.1 }) }),
        idleCtx(),
      ).outcome,
    ).toBe('NOT_DETECTED');
    const sparse = idleRule.evaluate(
      redshiftCluster({ utilization: redshiftMetrics({ connMax: 0, coverage: 0.5 }) }),
      idleCtx(),
    );
    expect(sparse.outcome === 'NOT_EVALUATED' && sparse.reason).toMatch(/^INSUFFICIENT_METRIC_COVERAGE/);
    const lenient = idleRule.evaluate(
      redshiftCluster({ utilization: redshiftMetrics({ connMax: 0, coverage: 0.5 }) }),
      idleCtx({ minCoverage: 0.4 }),
    );
    expect(lenient.outcome === 'DETECTED' && lenient.confidence).toBe('MEDIUM');
  });

  it('handles cluster states', () => {
    expect(
      idleRule.evaluate(redshiftCluster({ attributes: { clusterStatus: 'paused' } }), idleCtx()).outcome,
    ).toBe('NOT_DETECTED');
    expect(
      idleRule.evaluate(redshiftCluster({ attributes: { clusterStatus: 'resizing' } }), idleCtx()),
    ).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'TRANSIENT_STATE: resizing',
    });
  });
});

describe('redshift-pause-schedule', () => {
  it('uses zeroFraction as the pausable fraction', () => {
    const out = scheduleRule.evaluate(
      redshiftCluster({ utilization: redshiftMetrics({ zeroFraction: 0.6 }) }),
      scheduleCtx(),
    );
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.suggestedAction.type).toBe('SCHEDULE_PAUSE_RESUME');
    expect(out.confidence).toBe('MEDIUM');
    expect(out.savingsRequest).toEqual({
      kind: 'REDSHIFT_PAUSE',
      region: 'us-east-1',
      nodeType: 'ra3.xlplus',
      numberOfNodes: 2,
      pausableFraction: 0.6,
    });
    expect(out.evidence.find((e) => e.key === 'connections.zeroFraction')).toMatchObject({
      value: 60,
      threshold: '>= 40',
    });
    expect(out.evidence.find((e) => e.key === 'connections.idleHours')?.value).toBe(432);
  });

  it('is NOT_DETECTED below minIdleFraction (overridable) and for fully idle clusters', () => {
    const r = redshiftCluster({ utilization: redshiftMetrics({ zeroFraction: 0.1 }) });
    expect(scheduleRule.evaluate(r, scheduleCtx()).outcome).toBe('NOT_DETECTED');
    expect(scheduleRule.evaluate(r, scheduleCtx({ minIdleFraction: 0.05 })).outcome).toBe('DETECTED');
    const fullyIdle = redshiftCluster({ utilization: redshiftMetrics({ connMax: 0 }) });
    expect(scheduleRule.evaluate(fullyIdle, scheduleCtx()).outcome).toBe('NOT_DETECTED');
    expect(idleRule.evaluate(fullyIdle, idleCtx()).outcome).toBe('DETECTED');
  });

  it('is NOT_EVALUATED without zeroFraction, data or coverage', () => {
    expect(
      scheduleRule.evaluate(
        redshiftCluster({ utilization: redshiftMetrics({ zeroFraction: null }) }),
        scheduleCtx(),
      ),
    ).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRIC_STATISTICS_INCOMPLETE: zeroFraction',
    });
    expect(
      scheduleRule.evaluate(
        redshiftCluster({ utilization: redshiftMetrics({ connMax: null }) }),
        scheduleCtx(),
      ).outcome,
    ).toBe('NOT_EVALUATED');
    const low = scheduleRule.evaluate(
      redshiftCluster({ utilization: redshiftMetrics({ zeroFraction: 0.6, coverage: 0.5 }) }),
      scheduleCtx(),
    );
    expect(low.outcome === 'NOT_EVALUATED' && low.reason).toMatch(/^INSUFFICIENT_METRIC_COVERAGE/);
  });
});
