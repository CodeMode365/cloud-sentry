import { describe, expect, it } from 'vitest';
import type { DiscoveredResource } from '@cloudsentry/shared-types';
import { silentLogger } from '@cloudsentry/utilities';
import { runRegionalDiscovery } from './run-discovery';
import type { DiscoveryClients } from './registry';

function eip(region: string, id: string): DiscoveredResource {
  return {
    resourceType: 'ELASTIC_IP',
    accountId: '111122223333',
    region,
    resourceId: id,
    arn: null,
    name: null,
    state: 'unassociated',
    tags: {},
    createdAt: null,
    attributes: {
      allocationId: id,
      publicIp: null,
      associationId: null,
      instanceId: null,
      networkInterfaceId: null,
      privateIpAddress: null,
      domain: 'vpc',
    },
  };
}

const awsError = (name: string, message = name) => Object.assign(new Error(message), { name });
const clients = {} as DiscoveryClients;

describe('runRegionalDiscovery', () => {
  it('isolates regional failures, deduplicates, and retries throttled regions', async () => {
    let throttledCalls = 0;
    const result = await runRegionalDiscovery(
      'ELASTIC_IP',
      ['us-east-1', 'eu-west-1', 'ap-south-1', 'us-east-1'],
      clients,
      {
        accountId: '111122223333',
        logger: silentLogger,
        retry: { sleep: async () => undefined, baseDelayMs: 1 },
        modules: {
          ELASTIC_IP: async (_c, ctx) => {
            if (ctx.region === 'eu-west-1') throw awsError('UnauthorizedOperation', 'You are not authorized');
            if (ctx.region === 'ap-south-1') {
              throttledCalls++;
              if (throttledCalls === 1) throw awsError('RequestLimitExceeded');
              return [eip('ap-south-1', 'eipalloc-3')];
            }
            return [
              eip(ctx.region, 'eipalloc-1'),
              eip(ctx.region, 'eipalloc-1'),
              eip(ctx.region, 'eipalloc-2'),
            ];
          },
        },
      },
    );

    expect(result.regionsSucceeded.sort()).toEqual(['ap-south-1', 'us-east-1']);
    expect(result.regionsFailed).toEqual([
      { region: 'eu-west-1', errorCode: 'UnauthorizedOperation', message: 'You are not authorized' },
    ]);
    expect(result.resources.map((r) => `${r.region}/${r.resourceId}`).sort()).toEqual([
      'ap-south-1/eipalloc-3',
      'us-east-1/eipalloc-1',
      'us-east-1/eipalloc-2',
    ]);
    expect(throttledCalls).toBe(2);
  });

  it('does not retry non-throttling errors and reports every region failed when all fail', async () => {
    let calls = 0;
    const result = await runRegionalDiscovery('ELASTIC_IP', ['us-east-1', 'us-west-2'], clients, {
      accountId: '111122223333',
      logger: silentLogger,
      modules: {
        ELASTIC_IP: async () => {
          calls++;
          throw awsError('AuthFailure');
        },
      },
    });
    expect(calls).toBe(2);
    expect(result.resources).toEqual([]);
    expect(result.regionsSucceeded).toEqual([]);
    expect(result.regionsFailed.map((f) => f.errorCode)).toEqual(['AuthFailure', 'AuthFailure']);
  });
});
