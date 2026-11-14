import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { ec2Instance, idleEc2Metrics, series, utilizationOf } from '../__fixtures__/resources';
import { idleEc2Rule } from './idle-ec2';

const ctx = (o = {}) => ctxFor(idleEc2Rule.defaultThresholds, o);

describe('idle-ec2', () => {
  it('detects a running instance with low average CPU, low peak CPU and low network', () => {
    const r = ec2Instance({ utilization: idleEc2Metrics() });
    const out = idleEc2Rule.evaluate(r, ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.confidence).toBe('HIGH');
    expect(out.suggestedAction.type).toBe('STOP_INSTANCE');
    expect(out.savingsRequest).toEqual({
      kind: 'EC2_INSTANCE_STOP',
      region: 'us-east-1',
      instanceType: 't3.large',
      operatingSystem: 'Linux',
      tenancy: 'Shared',
      preInstalledSw: 'NA',
      licenseModel: 'No License required',
      nonOnDemandLifecycle: null,
    });
    expect(out.evidence.find((e) => e.key === 'cpu.average')?.value).toBe(1.2);
  });

  it('does not flag an instance on low average CPU alone when peaks are high', () => {
    const r = ec2Instance({ utilization: idleEc2Metrics({ cpuAvg: 1, cpuMax: 60 }) });
    expect(idleEc2Rule.evaluate(r, ctx()).outcome).toBe('NOT_DETECTED');
  });

  it('does not flag an instance with significant network traffic', () => {
    const r = ec2Instance({ utilization: idleEc2Metrics({ netMbPerDay: 500 }) });
    expect(idleEc2Rule.evaluate(r, ctx()).outcome).toBe('NOT_DETECTED');
  });

  it('treats missing CPU data as NOT_EVALUATED, not as zero utilization', () => {
    const util = utilizationOf([
      series('AWS/EC2', 'CPUUtilization', 'Average', { availability: 'NO_DATA' }),
      series('AWS/EC2', 'CPUUtilization', 'Maximum', { availability: 'NO_DATA' }),
      series('AWS/EC2', 'NetworkIn', 'Sum', { average: 0 }),
      series('AWS/EC2', 'NetworkOut', 'Sum', { average: 0 }),
    ]);
    const out = idleEc2Rule.evaluate(ec2Instance({ utilization: util }), ctx());
    expect(out).toEqual({ outcome: 'NOT_EVALUATED', reason: 'METRIC_NO_DATA: CPUUtilization:Average' });
  });

  it('treats genuinely zero utilization (data present) as idle', () => {
    const r = ec2Instance({ utilization: idleEc2Metrics({ cpuAvg: 0, cpuMax: 0, netMbPerDay: 0 }) });
    expect(idleEc2Rule.evaluate(r, ctx()).outcome).toBe('DETECTED');
  });

  it('is NOT_EVALUATED when metrics were never collected', () => {
    expect(idleEc2Rule.evaluate(ec2Instance(), ctx())).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRICS_NOT_COLLECTED',
    });
  });

  it('requires the minimum observation period', () => {
    const r = ec2Instance({ utilization: idleEc2Metrics({ observableDays: 10 }) });
    const out = idleEc2Rule.evaluate(r, ctx());
    expect(out.outcome).toBe('NOT_EVALUATED');
    expect(out.outcome === 'NOT_EVALUATED' && out.reason).toMatch(/^INSUFFICIENT_OBSERVATION_PERIOD/);
  });

  it('requires minimum metric coverage', () => {
    const r = ec2Instance({ utilization: idleEc2Metrics({ coverage: 0.5 }) });
    const out = idleEc2Rule.evaluate(r, ctx());
    expect(out.outcome === 'NOT_EVALUATED' && out.reason).toMatch(/^INSUFFICIENT_METRIC_COVERAGE/);
  });

  it('reports MEDIUM confidence with shorter observation', () => {
    const r = ec2Instance({ utilization: idleEc2Metrics({ observableDays: 20 }) });
    const out = idleEc2Rule.evaluate(r, ctx());
    expect(out.outcome === 'DETECTED' && out.confidence).toBe('MEDIUM');
  });

  it('honours threshold overrides', () => {
    const r = ec2Instance({ utilization: idleEc2Metrics({ cpuAvg: 7, cpuMax: 9 }) });
    expect(idleEc2Rule.evaluate(r, ctx()).outcome).toBe('NOT_DETECTED');
    expect(idleEc2Rule.evaluate(r, ctx({ cpuAverageMaxPercent: 8 })).outcome).toBe('DETECTED');
  });

  it('returns NOT_DETECTED for stopped instances and NOT_EVALUATED for pending', () => {
    expect(idleEc2Rule.evaluate(ec2Instance({ state: 'stopped' }), ctx()).outcome).toBe('NOT_DETECTED');
    expect(idleEc2Rule.evaluate(ec2Instance({ state: 'pending' }), ctx()).outcome).toBe('NOT_EVALUATED');
  });

  it('maps SQL Server platforms and passes spot lifecycle through', () => {
    const r = ec2Instance({
      utilization: idleEc2Metrics(),
      attributes: {
        platformDetails: 'Windows with SQL Server Standard',
        instanceLifecycle: 'spot',
        tenancy: 'dedicated',
      },
    });
    const out = idleEc2Rule.evaluate(r, ctx());
    expect(out.outcome === 'DETECTED' && out.savingsRequest).toMatchObject({
      operatingSystem: 'Windows',
      preInstalledSw: 'SQL Std',
      tenancy: 'Dedicated',
      nonOnDemandLifecycle: 'spot',
    });
  });

  it('omits the savings request for unsupported platforms and dedicated hosts', () => {
    for (const attributes of [{ platformDetails: 'Ubuntu Pro' }, { tenancy: 'host' }]) {
      const out = idleEc2Rule.evaluate(ec2Instance({ utilization: idleEc2Metrics(), attributes }), ctx());
      expect(out.outcome).toBe('DETECTED');
      if (out.outcome !== 'DETECTED') return;
      expect(out.savingsRequest).toBeNull();
      expect(out.evidence.some((e) => e.key === 'pricing.unsupported')).toBe(true);
    }
  });
});
