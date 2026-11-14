import { describe, expect, it, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { DescribeRegionsCommand, EC2Client } from '@aws-sdk/client-ec2';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import {
  DescribeLoadBalancersCommand,
  ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { IAMClient, ListAccountAliasesCommand } from '@aws-sdk/client-iam';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { EKSClient } from '@aws-sdk/client-eks';
import { ElastiCacheClient } from '@aws-sdk/client-elasticache';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { EFSClient } from '@aws-sdk/client-efs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { RedshiftClient } from '@aws-sdk/client-redshift';
import { BackupClient } from '@aws-sdk/client-backup';
import { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { silentLogger } from '@cloudsentry/utilities';
import { StsRoleVerifier, classifyAssumeRoleError } from './role-verifier';
import { memoizeCredentials, toSessionName } from './credentials';

const sts = mockClient(STSClient);
const ec2 = mockClient(EC2Client);
const rds = mockClient(RDSClient);
const elb = mockClient(ElasticLoadBalancingV2Client);
const cw = mockClient(CloudWatchClient);
const iam = mockClient(IAMClient);
const extended = [
  LambdaClient,
  EKSClient,
  ElastiCacheClient,
  CloudFrontClient,
  EFSClient,
  DynamoDBClient,
  RedshiftClient,
  BackupClient,
  ResourceGroupsTaggingAPIClient,
].map((c) => mockClient(c));

const request = {
  roleArn: 'arn:aws:iam::123456789012:role/CloudSentryReadOnlyRole',
  externalId: 'cs-external',
  expectedAccountId: '123456789012',
  probeRegion: 'us-east-1',
};

function assumeOk() {
  sts.on(AssumeRoleCommand).resolves({
    Credentials: {
      AccessKeyId: 'ASIA',
      SecretAccessKey: 's',
      SessionToken: 't',
      Expiration: new Date(Date.now() + 900_000),
    },
    AssumedRoleUser: {
      Arn: 'arn:aws:sts::123456789012:assumed-role/CloudSentryReadOnlyRole/x',
      AssumedRoleId: 'x',
    },
  });
}

describe('StsRoleVerifier', () => {
  beforeEach(() => {
    for (const m of [sts, ec2, rds, elb, cw, iam]) m.reset();
    for (const m of extended) {
      m.reset();
      m.onAnyCommand().resolves({});
    }
  });

  it('passes the external ID and verifies the account and permissions', async () => {
    assumeOk();
    sts.on(GetCallerIdentityCommand).resolves({ Account: '123456789012' });
    ec2
      .on(DescribeRegionsCommand)
      .resolves({ Regions: [{ RegionName: 'us-west-2' }, { RegionName: 'us-east-1' }] });
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [] });
    elb.on(DescribeLoadBalancersCommand).resolves({ LoadBalancers: [] });
    cw.on(GetMetricDataCommand).resolves({ MetricDataResults: [] });
    iam.on(ListAccountAliasesCommand).resolves({ AccountAliases: ['acme-prod'] });

    const result = await new StsRoleVerifier(silentLogger, new STSClient({ region: 'us-east-1' })).verify(
      request,
    );
    expect(result.success).toBe(true);
    expect(result.enabledRegions).toEqual(['us-east-1', 'us-west-2']);
    expect(result.accountAliases).toEqual(['acme-prod']);
    expect(sts.commandCalls(AssumeRoleCommand)[0]?.args[0].input).toMatchObject({
      ExternalId: 'cs-external',
      RoleArn: request.roleArn,
    });
    expect(result.permissionChecks.find((c) => c.action === 'ce:GetCostAndUsage')?.status).toBe(
      'NOT_CHECKED',
    );
    expect(result.permissionChecks.find((c) => c.action === 'lambda:ListFunctions')?.status).toBe('ALLOWED');
  });

  it('reports account mismatch when the role belongs to another account', async () => {
    assumeOk();
    sts.on(GetCallerIdentityCommand).resolves({ Account: '999999999999' });
    const result = await new StsRoleVerifier(silentLogger, new STSClient({ region: 'us-east-1' })).verify(
      request,
    );
    expect(result).toMatchObject({ success: false, errorCode: 'ACCOUNT_MISMATCH' });
  });

  it('classifies AssumeRole access denied as a trust/external ID problem', async () => {
    sts.on(AssumeRoleCommand).rejects(Object.assign(new Error('not authorized'), { name: 'AccessDenied' }));
    const result = await new StsRoleVerifier(silentLogger, new STSClient({ region: 'us-east-1' })).verify(
      request,
    );
    expect(result).toMatchObject({ success: false, errorCode: 'ASSUME_ROLE_DENIED' });
    expect(result.errorMessage).toMatch(/external ID/);
  });

  it('marks denied optional permissions without failing verification', async () => {
    assumeOk();
    sts.on(GetCallerIdentityCommand).resolves({ Account: '123456789012' });
    ec2.on(DescribeRegionsCommand).resolves({ Regions: [{ RegionName: 'us-east-1' }] });
    rds.on(DescribeDBInstancesCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    elb.on(DescribeLoadBalancersCommand).resolves({});
    cw.on(GetMetricDataCommand).resolves({});
    iam.on(ListAccountAliasesCommand).resolves({ AccountAliases: [] });
    const result = await new StsRoleVerifier(silentLogger, new STSClient({ region: 'us-east-1' })).verify(
      request,
    );
    expect(result.success).toBe(true);
    expect(result.permissionChecks.find((c) => c.action === 'rds:DescribeDBInstances')?.status).toBe(
      'DENIED',
    );
  });

  it('reports missing extended-service permissions (old role templates) without failing verification', async () => {
    assumeOk();
    sts.on(GetCallerIdentityCommand).resolves({ Account: '123456789012' });
    ec2.on(DescribeRegionsCommand).resolves({ Regions: [{ RegionName: 'us-east-1' }] });
    for (const m of [rds, elb, cw, iam]) m.onAnyCommand().resolves({});
    for (const m of extended) {
      m.onAnyCommand().rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    }
    const result = await new StsRoleVerifier(silentLogger, new STSClient({ region: 'us-east-1' })).verify(
      request,
    );
    expect(result.success).toBe(true);
    const denied = result.permissionChecks.filter((c) => c.status === 'DENIED').map((c) => c.action);
    expect(denied).toEqual(
      expect.arrayContaining(['lambda:ListFunctions', 'dynamodb:ListTables', 'tag:GetResources']),
    );
  });

  it('fails when the required DescribeRegions permission is missing', async () => {
    assumeOk();
    sts.on(GetCallerIdentityCommand).resolves({ Account: '123456789012' });
    ec2
      .on(DescribeRegionsCommand)
      .rejects(Object.assign(new Error('denied'), { name: 'UnauthorizedOperation' }));
    const result = await new StsRoleVerifier(silentLogger, new STSClient({ region: 'us-east-1' })).verify(
      request,
    );
    expect(result).toMatchObject({ success: false, errorCode: 'MISSING_REQUIRED_PERMISSION' });
  });
});

describe('credentials helpers', () => {
  it('classifies platform credential problems separately', () => {
    expect(classifyAssumeRoleError({ name: 'ExpiredTokenException' }).code).toBe(
      'PLATFORM_CREDENTIALS_INVALID',
    );
  });

  it('builds valid session names', () => {
    expect(toSessionName('scan_01H/x y')).toMatch(/^[\w+=,.@-]{2,64}$/);
    expect(toSessionName('a'.repeat(100))).toHaveLength(64);
  });

  it('memoizes credentials until near expiry and refreshes after', async () => {
    let calls = 0;
    const provider = memoizeCredentials(async () => {
      calls++;
      return {
        accessKeyId: 'a',
        secretAccessKey: 'b',
        expiration: new Date(Date.now() + (calls === 1 ? 60_000 : 3_600_000)),
      };
    });
    await Promise.all([provider(), provider(), provider()]);
    expect(calls).toBe(1);
    await provider(); // first creds expire within the 5 minute margin, so this refreshes
    expect(calls).toBe(2);
    await provider();
    expect(calls).toBe(2);
  });
});
