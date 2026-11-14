import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CloudFrontClient, ListDistributionsCommand } from '@aws-sdk/client-cloudfront';
import { distributionsPage1, distributionsPage2 } from '../__fixtures__/cloudfront';
import { discoverCloudFrontDistributions } from './cloudfront-distributions';

const cfMock = mockClient(CloudFrontClient);

beforeEach(() => cfMock.reset());

describe('discoverCloudFrontDistributions', () => {
  it('follows DistributionList.NextMarker, maps fields and always uses region global', async () => {
    cfMock.on(ListDistributionsCommand).resolvesOnce(distributionsPage1).resolvesOnce(distributionsPage2);
    const result = await discoverCloudFrontDistributions(new CloudFrontClient({ region: 'us-east-1' }), {
      accountId: '111122223333',
      region: 'us-east-1',
    });

    const calls = cfMock.commandCalls(ListDistributionsCommand);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args[0].input.Marker).toBe('EDFDVBD6EXAMPLE2');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      resourceType: 'CLOUDFRONT_DISTRIBUTION',
      accountId: '111122223333',
      region: 'global',
      resourceId: 'EDFDVBD6EXAMPLE1',
      arn: 'arn:aws:cloudfront::111122223333:distribution/EDFDVBD6EXAMPLE1',
      name: 'cdn.example.invalid',
      state: 'Enabled',
      tags: {},
      createdAt: null,
      attributes: {
        distributionId: 'EDFDVBD6EXAMPLE1',
        domainName: 'd111111abcdef8.cloudfront.net',
        enabled: true,
        priceClass: 'PriceClass_100',
        httpVersion: 'http2',
        aliases: ['cdn.example.invalid', 'static.example.invalid'],
        defaultCacheBehaviorCompress: true,
        originCount: 2,
        webAclId: 'arn:aws:wafv2:us-east-1:111122223333:global/webacl/fixture/abc',
        lastModifiedTime: '2026-05-01T00:00:00.000Z',
      },
    });
    expect(result[1]).toMatchObject({
      region: 'global',
      arn: 'arn:aws:cloudfront::111122223333:distribution/EDFDVBD6EXAMPLE2',
      name: 'd222222abcdef8.cloudfront.net',
      state: 'Disabled',
      attributes: {
        enabled: false,
        aliases: [],
        defaultCacheBehaviorCompress: false,
        originCount: 1,
        webAclId: null,
        httpVersion: 'http2and3',
      },
    });
  });
});
