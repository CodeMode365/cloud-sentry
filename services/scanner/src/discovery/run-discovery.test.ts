import { describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CloudFrontClient, ListDistributionsCommand } from '@aws-sdk/client-cloudfront';
import { RESOURCE_TYPES, type DiscoveredResource } from '@cloudsentry/shared-types';
import { silentLogger } from '@cloudsentry/utilities';
import { distributionsPage2 } from '../__fixtures__/cloudfront';
import { runRegionalDiscovery } from './run-discovery';
import { DISCOVERY_MODULES, type DiscoveryClients, type DiscoveryModule } from './registry';

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

describe('runRegionalDiscovery for global resource types', () => {
  const distribution = (id: string): DiscoveredResource => ({
    resourceType: 'CLOUDFRONT_DISTRIBUTION',
    accountId: '111122223333',
    region: 'global',
    resourceId: id,
    arn: null,
    name: id,
    state: 'Enabled',
    tags: {},
    createdAt: null,
    attributes: {
      distributionId: id,
      domainName: null,
      enabled: true,
      priceClass: null,
      httpVersion: null,
      aliases: [],
      defaultCacheBehaviorCompress: null,
      originCount: 1,
      webAclId: null,
      lastModifiedTime: null,
    },
  });

  it('runs CloudFront exactly once with region global, whatever the regions list holds', async () => {
    for (const regions of [['us-east-1', 'eu-west-1', 'ap-south-1'], []]) {
      const seenRegions: string[] = [];
      const result = await runRegionalDiscovery('CLOUDFRONT_DISTRIBUTION', regions, clients, {
        accountId: '111122223333',
        logger: silentLogger,
        modules: {
          CLOUDFRONT_DISTRIBUTION: async (_c, ctx) => {
            seenRegions.push(ctx.region);
            expect(ctx.logger).toBeDefined();
            return [distribution('E1'), distribution('E1'), distribution('E2')];
          },
        },
      });
      expect(seenRegions).toEqual(['global']);
      expect(result.regionsSucceeded).toEqual(['global']);
      expect(result.regionsFailed).toEqual([]);
      expect(result.resources.map((r) => r.resourceId)).toEqual(['E1', 'E2']);
    }
  });

  it('reports a global failure as region global', async () => {
    const result = await runRegionalDiscovery(
      'CLOUDFRONT_DISTRIBUTION',
      ['us-east-1', 'eu-west-1'],
      clients,
      {
        accountId: '111122223333',
        logger: silentLogger,
        modules: {
          CLOUDFRONT_DISTRIBUTION: async () => {
            throw awsError('AccessDenied', 'cloudfront:ListDistributions denied');
          },
        },
      },
    );
    expect(result.regionsSucceeded).toEqual([]);
    expect(result.regionsFailed).toEqual([
      { region: 'global', errorCode: 'AccessDenied', message: 'cloudfront:ListDistributions denied' },
    ]);
  });

  it('keeps per-region runs for regional types', async () => {
    const seen: string[] = [];
    const module: DiscoveryModule = async (_c, ctx) => {
      seen.push(ctx.region);
      return [];
    };
    const result = await runRegionalDiscovery(
      'LAMBDA_FUNCTION',
      ['us-east-1', 'eu-west-1', 'us-east-1'],
      clients,
      {
        accountId: '111122223333',
        logger: silentLogger,
        modules: { LAMBDA_FUNCTION: module },
      },
    );
    expect(seen.sort()).toEqual(['eu-west-1', 'us-east-1']);
    expect(result.regionsSucceeded.sort()).toEqual(['eu-west-1', 'us-east-1']);
  });

  it('uses the registry module with the global CloudFront client', async () => {
    const cloudfront = new CloudFrontClient({ region: 'us-east-1' });
    const cfMock = mockClient(cloudfront);
    cfMock.on(ListDistributionsCommand).resolves(distributionsPage2);
    let cloudfrontCalls = 0;
    const fakeClients = {
      cloudfront: () => {
        cloudfrontCalls++;
        return cloudfront;
      },
    } as unknown as DiscoveryClients;

    const result = await runRegionalDiscovery(
      'CLOUDFRONT_DISTRIBUTION',
      ['eu-west-1', 'us-west-2'],
      fakeClients,
      {
        accountId: '111122223333',
        logger: silentLogger,
      },
    );
    expect(cloudfrontCalls).toBe(1);
    expect(result.resources.map((r) => `${r.region}/${r.resourceId}`)).toEqual(['global/EDFDVBD6EXAMPLE2']);
    cfMock.restore();
  });
});

describe('DISCOVERY_MODULES', () => {
  it('covers every resource type', () => {
    expect(Object.keys(DISCOVERY_MODULES).sort()).toEqual([...RESOURCE_TYPES].sort());
  });
});
