import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { DescribeRegionsCommand, EC2Client } from '@aws-sdk/client-ec2';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import {
  DescribeLoadBalancersCommand,
  ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { IAMClient, ListAccountAliasesCommand } from '@aws-sdk/client-iam';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { EKSClient, ListClustersCommand } from '@aws-sdk/client-eks';
import { DescribeCacheClustersCommand, ElastiCacheClient } from '@aws-sdk/client-elasticache';
import { CloudFrontClient, ListDistributionsCommand } from '@aws-sdk/client-cloudfront';
import { DescribeFileSystemsCommand, EFSClient } from '@aws-sdk/client-efs';
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { DescribeClustersCommand, RedshiftClient } from '@aws-sdk/client-redshift';
import { BackupClient, ListBackupPlansCommand } from '@aws-sdk/client-backup';
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from '@aws-sdk/client-resource-groups-tagging-api';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import type { AccountVerificationResult, PermissionCheckResult } from '@cloudsentry/shared-types';
import { awsErrorName, errorMessage, type Logger } from '@cloudsentry/utilities';
import { clientDefaults } from './config';
import { toSessionName } from './credentials';

export interface RoleVerificationRequest {
  roleArn: string;
  externalId: string;
  expectedAccountId: string;
  /** Region used for permission probes. */
  probeRegion: string;
}

export interface RoleVerificationResult extends AccountVerificationResult {
  accountAliases: string[];
}

export interface RoleVerifier {
  verify(request: RoleVerificationRequest): Promise<RoleVerificationResult>;
}

/** Maps STS AssumeRole failures to actionable, customer-facing guidance. */
export function classifyAssumeRoleError(error: unknown): { code: string; message: string } {
  const name = awsErrorName(error) ?? 'UnknownError';
  switch (name) {
    case 'AccessDenied':
    case 'AccessDeniedException':
      return {
        code: 'ASSUME_ROLE_DENIED',
        message:
          'CloudSentry could not assume the role. Confirm the role exists, its trust policy trusts the CloudSentry ' +
          'account, and the sts:ExternalId condition matches the external ID shown in CloudSentry.',
      };
    case 'RegionDisabledException':
      return {
        code: 'STS_REGION_DISABLED',
        message: 'STS is not activated in the requested region for this account.',
      };
    case 'MalformedPolicyDocumentException':
    case 'ValidationError':
      return {
        code: 'ASSUME_ROLE_INVALID_REQUEST',
        message: `AssumeRole request was rejected: ${errorMessage(error)}`,
      };
    case 'ExpiredTokenException':
    case 'InvalidClientTokenId':
    case 'UnrecognizedClientException':
      return {
        code: 'PLATFORM_CREDENTIALS_INVALID',
        message:
          'CloudSentry platform credentials are invalid or expired. This is a CloudSentry configuration issue.',
      };
    default:
      return { code: 'ASSUME_ROLE_FAILED', message: `AssumeRole failed (${name}): ${errorMessage(error)}` };
  }
}

function permissionResult(action: string, error: unknown): PermissionCheckResult {
  const name = awsErrorName(error);
  if (name && /AccessDenied|UnauthorizedOperation|AuthorizationError|AccessDeniedException/.test(name)) {
    return { action, status: 'DENIED', message: `${name}: permission not granted` };
  }
  return { action, status: 'ERROR', message: `${name ?? 'Error'}: ${errorMessage(error)}` };
}

/**
 * Verifies a customer's cross-account role: AssumeRole with the external ID, confirms the caller account
 * matches the registered account (account ID verification), and probes each read-only permission.
 */
export class StsRoleVerifier implements RoleVerifier {
  constructor(
    private readonly logger: Logger,
    private readonly stsClient: STSClient = new STSClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      ...clientDefaults({ maxAttempts: 3 }),
    }),
  ) {}

  async verify(request: RoleVerificationRequest): Promise<RoleVerificationResult> {
    const verifiedAt = new Date().toISOString();
    const base: RoleVerificationResult = {
      verifiedAt,
      success: false,
      assumedRoleArn: null,
      callerAccountId: null,
      enabledRegions: [],
      permissionChecks: [],
      errorCode: null,
      errorMessage: null,
      accountAliases: [],
    };

    let credentials: AwsCredentialIdentity;
    try {
      const assumed = await this.stsClient.send(
        new AssumeRoleCommand({
          RoleArn: request.roleArn,
          ExternalId: request.externalId,
          RoleSessionName: toSessionName(`verify-${Date.now()}`),
          DurationSeconds: 900,
        }),
      );
      const c = assumed.Credentials;
      if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) {
        return {
          ...base,
          errorCode: 'ASSUME_ROLE_FAILED',
          errorMessage: 'AssumeRole returned no credentials',
        };
      }
      credentials = {
        accessKeyId: c.AccessKeyId,
        secretAccessKey: c.SecretAccessKey,
        sessionToken: c.SessionToken,
        ...(c.Expiration ? { expiration: c.Expiration } : {}),
      };
      base.assumedRoleArn = assumed.AssumedRoleUser?.Arn ?? null;
    } catch (error) {
      const classified = classifyAssumeRoleError(error);
      this.logger.warn('Customer role assumption failed', {
        errorCode: classified.code,
        awsError: awsErrorName(error),
      });
      return { ...base, errorCode: classified.code, errorMessage: classified.message };
    }

    const cfg = { credentials, ...clientDefaults({ maxAttempts: 3 }) };
    try {
      const identity = await new STSClient({ ...cfg, region: request.probeRegion }).send(
        new GetCallerIdentityCommand({}),
      );
      base.callerAccountId = identity.Account ?? null;
    } catch (error) {
      return { ...base, errorCode: 'IDENTITY_CHECK_FAILED', errorMessage: errorMessage(error) };
    }
    if (base.callerAccountId !== request.expectedAccountId) {
      return {
        ...base,
        errorCode: 'ACCOUNT_MISMATCH',
        errorMessage: `The role belongs to account ${base.callerAccountId ?? 'unknown'}, not ${request.expectedAccountId}.`,
      };
    }

    const region = request.probeRegion;
    const checks: PermissionCheckResult[] = [];
    const probe = async (action: string, fn: () => Promise<unknown>): Promise<void> => {
      try {
        await fn();
        checks.push({ action, status: 'ALLOWED' });
      } catch (error) {
        checks.push(permissionResult(action, error));
      }
    };

    await probe('ec2:DescribeRegions', async () => {
      const out = await new EC2Client({ ...cfg, region }).send(
        new DescribeRegionsCommand({ AllRegions: false }),
      );
      base.enabledRegions = (out.Regions ?? [])
        .map((r) => r.RegionName)
        .filter((r): r is string => !!r)
        .sort();
    });
    await Promise.all([
      probe('rds:DescribeDBInstances', () =>
        new RDSClient({ ...cfg, region }).send(new DescribeDBInstancesCommand({ MaxRecords: 20 })),
      ),
      probe('elasticloadbalancing:DescribeLoadBalancers', () =>
        new ElasticLoadBalancingV2Client({ ...cfg, region }).send(
          new DescribeLoadBalancersCommand({ PageSize: 1 }),
        ),
      ),
      probe('cloudwatch:GetMetricData', () => {
        const end = new Date();
        return new CloudWatchClient({ ...cfg, region }).send(
          new GetMetricDataCommand({
            StartTime: new Date(end.getTime() - 3_600_000),
            EndTime: end,
            MetricDataQueries: [
              {
                Id: 'probe',
                MetricStat: {
                  Metric: { Namespace: 'AWS/EC2', MetricName: 'CPUUtilization' },
                  Period: 3600,
                  Stat: 'Average',
                },
              },
            ],
          }),
        );
      }),
      // Extended services (optional: a denied probe never fails verification; scans report those types as failed).
      probe('lambda:ListFunctions', () =>
        new LambdaClient({ ...cfg, region }).send(new ListFunctionsCommand({ MaxItems: 1 })),
      ),
      probe('eks:ListClusters', () =>
        new EKSClient({ ...cfg, region }).send(new ListClustersCommand({ maxResults: 1 })),
      ),
      probe('elasticache:DescribeCacheClusters', () =>
        new ElastiCacheClient({ ...cfg, region }).send(new DescribeCacheClustersCommand({ MaxRecords: 20 })),
      ),
      probe('cloudfront:ListDistributions', () =>
        new CloudFrontClient({ ...cfg, region: 'us-east-1' }).send(
          new ListDistributionsCommand({ MaxItems: 1 }),
        ),
      ),
      probe('elasticfilesystem:DescribeFileSystems', () =>
        new EFSClient({ ...cfg, region }).send(new DescribeFileSystemsCommand({ MaxItems: 1 })),
      ),
      probe('dynamodb:ListTables', () =>
        new DynamoDBClient({ ...cfg, region }).send(new ListTablesCommand({ Limit: 1 })),
      ),
      probe('redshift:DescribeClusters', () =>
        new RedshiftClient({ ...cfg, region }).send(new DescribeClustersCommand({ MaxRecords: 20 })),
      ),
      probe('backup:ListBackupPlans', () =>
        new BackupClient({ ...cfg, region }).send(new ListBackupPlansCommand({ MaxResults: 1 })),
      ),
      probe('tag:GetResources', () =>
        new ResourceGroupsTaggingAPIClient({ ...cfg, region }).send(
          new GetResourcesCommand({ ResourcesPerPage: 1 }),
        ),
      ),
      probe('iam:ListAccountAliases', async () => {
        const out = await new IAMClient({ ...cfg, region: 'us-east-1' }).send(
          new ListAccountAliasesCommand({}),
        );
        base.accountAliases = out.AccountAliases ?? [];
      }),
    ]);
    // Cost Explorer requests are billed (USD 0.01 each); access is checked during the first scan instead.
    checks.push({
      action: 'ce:GetCostAndUsage',
      status: 'NOT_CHECKED',
      message: 'Checked during the first scan (Cost Explorer API requests are billed per request).',
    });

    const required = ['ec2:DescribeRegions'];
    const blocking = checks.find((c) => required.includes(c.action) && c.status !== 'ALLOWED');
    const result: RoleVerificationResult = {
      ...base,
      permissionChecks: checks,
      success: !blocking,
      errorCode: blocking ? 'MISSING_REQUIRED_PERMISSION' : null,
      errorMessage: blocking
        ? `Required permission ${blocking.action} is not available: ${blocking.message ?? ''}`
        : null,
    };
    this.logger.info('Customer role verified', {
      accountId: request.expectedAccountId,
      success: result.success,
      denied: checks.filter((c) => c.status === 'DENIED').map((c) => c.action),
    });
    return result;
  }
}
