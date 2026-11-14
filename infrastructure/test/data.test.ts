import { Match } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { handlersPresent, synth } from './helpers';

describe.skipIf(!handlersPresent)('DataStack', () => {
  it('creates the single table with PK/SK, GSI1, TTL and on-demand billing', () => {
    const t = synth().templates.data;
    t.resourceCountIs('AWS::DynamoDB::GlobalTable', 1);
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'cloudsentry-dev-main',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        Match.objectLike({
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        }),
      ],
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      SSESpecification: { SSEEnabled: true, SSEType: 'KMS' },
    });
  });

  it('configures point-in-time recovery per stage (disabled in dev)', () => {
    const t = synth().templates.data;
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      Replicas: [
        Match.objectLike({
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
        }),
      ],
    });
  });

  it('blocks public access, encrypts, and enforces TLS on the artifacts bucket', () => {
    const t = synth().templates.data;
    t.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
      },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ Id: 'expire-reports', Prefix: 'reports/', Status: 'Enabled' }),
          Match.objectLike({ Id: 'expire-scan-artifacts', Prefix: 'scans/', Status: 'Enabled' }),
        ]),
      },
    });
    t.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: 's3:*',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });
});
