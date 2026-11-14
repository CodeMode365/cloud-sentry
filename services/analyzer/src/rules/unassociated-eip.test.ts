import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { elasticIp } from '../__fixtures__/resources';
import { unassociatedEipRule } from './unassociated-eip';

describe('unassociated-eip', () => {
  const ctx = ctxFor({});
  it('detects an address without association', () => {
    const out = unassociatedEipRule.evaluate(elasticIp(), ctx);
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.confidence).toBe('HIGH');
    expect(out.savingsRequest).toEqual({ kind: 'ELASTIC_IP_RELEASE', region: 'us-east-1' });
  });
  it('ignores associated addresses', () => {
    expect(
      unassociatedEipRule.evaluate(
        elasticIp({ attributes: { associationId: 'eipassoc-1', instanceId: 'i-1' } }),
        ctx,
      ).outcome,
    ).toBe('NOT_DETECTED');
    expect(
      unassociatedEipRule.evaluate(elasticIp({ attributes: { networkInterfaceId: 'eni-1' } }), ctx).outcome,
    ).toBe('NOT_DETECTED');
  });
});
