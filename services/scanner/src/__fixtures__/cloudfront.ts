/** SYNTHETIC TEST FIXTURE: SDK-shaped ListDistributions pages. Not real AWS data. */
import type { DistributionSummary, ListDistributionsCommandOutput } from '@aws-sdk/client-cloudfront';

function summary(overrides: Partial<DistributionSummary>): DistributionSummary {
  return {
    Id: undefined,
    ARN: undefined,
    Status: 'Deployed',
    LastModifiedTime: new Date('2026-05-01T00:00:00Z'),
    DomainName: undefined,
    Aliases: { Quantity: 0 },
    Origins: { Quantity: 1, Items: [{ Id: 'origin-1', DomainName: 'origin.example.invalid' }] },
    DefaultCacheBehavior: {
      TargetOriginId: 'origin-1',
      ViewerProtocolPolicy: 'redirect-to-https',
      Compress: true,
    },
    CacheBehaviors: { Quantity: 0 },
    CustomErrorResponses: { Quantity: 0 },
    Comment: '',
    PriceClass: 'PriceClass_All',
    Enabled: true,
    ViewerCertificate: {},
    Restrictions: { GeoRestriction: { RestrictionType: 'none', Quantity: 0 } },
    WebACLId: '',
    HttpVersion: 'http2',
    IsIPV6Enabled: true,
    Staging: false,
    ...overrides,
  };
}

export const distributionsPage1: Partial<ListDistributionsCommandOutput> = {
  DistributionList: {
    Marker: '',
    NextMarker: 'EDFDVBD6EXAMPLE2',
    MaxItems: 100,
    IsTruncated: true,
    Quantity: 1,
    Items: [
      summary({
        Id: 'EDFDVBD6EXAMPLE1',
        ARN: 'arn:aws:cloudfront::111122223333:distribution/EDFDVBD6EXAMPLE1',
        DomainName: 'd111111abcdef8.cloudfront.net',
        Aliases: { Quantity: 2, Items: ['cdn.example.invalid', 'static.example.invalid'] },
        Origins: {
          Quantity: 2,
          Items: [
            { Id: 'origin-1', DomainName: 'origin.example.invalid' },
            { Id: 'origin-2', DomainName: 'origin2.example.invalid' },
          ],
        },
        PriceClass: 'PriceClass_100',
        WebACLId: 'arn:aws:wafv2:us-east-1:111122223333:global/webacl/fixture/abc',
      }),
    ],
  },
};

export const distributionsPage2: Partial<ListDistributionsCommandOutput> = {
  DistributionList: {
    Marker: 'EDFDVBD6EXAMPLE2',
    MaxItems: 100,
    IsTruncated: false,
    Quantity: 1,
    Items: [
      summary({
        Id: 'EDFDVBD6EXAMPLE2',
        DomainName: 'd222222abcdef8.cloudfront.net',
        Enabled: false,
        HttpVersion: 'http2and3',
        DefaultCacheBehavior: {
          TargetOriginId: 'origin-1',
          ViewerProtocolPolicy: 'allow-all',
          Compress: false,
        },
      }),
    ],
  },
};
