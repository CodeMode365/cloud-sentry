import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { natGateway, natMetrics } from '../__fixtures__/resources';
import { idleNatGatewayRule } from './idle-nat-gateway';

const ctx = (o = {}) => ctxFor(idleNatGatewayRule.defaultThresholds, o);

describe('idle-nat-gateway', () => {
  it('flags low-traffic gateways with HIGH risk and never HIGH confidence', () => {
    const out = idleNatGatewayRule.evaluate(natGateway({ utilization: natMetrics() }), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.riskLevel).toBe('HIGH');
    expect(out.confidence).toBe('MEDIUM');
    expect(out.suggestedAction.type).toBe('REVIEW_NAT_GATEWAY');
    expect(out.savingsRequest).toEqual({ kind: 'NAT_GATEWAY_DELETE', region: 'us-east-1' });
  });

  it('reports LOW confidence with shorter observation', () => {
    const out = idleNatGatewayRule.evaluate(
      natGateway({ utilization: natMetrics({ observableDays: 20 }) }),
      ctx(),
    );
    expect(out.outcome === 'DETECTED' && out.confidence).toBe('LOW');
  });

  it('does not flag gateways with traffic or many connections', () => {
    expect(
      idleNatGatewayRule.evaluate(natGateway({ utilization: natMetrics({ gbPerDay: 5 }) }), ctx()).outcome,
    ).toBe('NOT_DETECTED');
    expect(
      idleNatGatewayRule.evaluate(natGateway({ utilization: natMetrics({ maxConn: 50 }) }), ctx()).outcome,
    ).toBe('NOT_DETECTED');
  });

  it('handles lifecycle states and coverage', () => {
    expect(idleNatGatewayRule.evaluate(natGateway({ state: 'deleted' }), ctx()).outcome).toBe('NOT_DETECTED');
    expect(idleNatGatewayRule.evaluate(natGateway({ state: 'pending' }), ctx()).outcome).toBe(
      'NOT_EVALUATED',
    );
    expect(
      idleNatGatewayRule.evaluate(natGateway({ utilization: natMetrics({ coverage: 0.3 }) }), ctx()).outcome,
    ).toBe('NOT_EVALUATED');
  });

  it('honours maxGbPerDay override', () => {
    const r = natGateway({ utilization: natMetrics({ gbPerDay: 3 }) });
    expect(idleNatGatewayRule.evaluate(r, ctx()).outcome).toBe('NOT_DETECTED');
    expect(idleNatGatewayRule.evaluate(r, ctx({ maxGbPerDay: 4 })).outcome).toBe('DETECTED');
  });
});
