import type { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { EC2Client } from '@aws-sdk/client-ec2';
import { RDSClient } from '@aws-sdk/client-rds';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { IAMClient } from '@aws-sdk/client-iam';
import { STSClient } from '@aws-sdk/client-sts';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { EKSClient } from '@aws-sdk/client-eks';
import { ElastiCacheClient } from '@aws-sdk/client-elasticache';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { EFSClient } from '@aws-sdk/client-efs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { RedshiftClient } from '@aws-sdk/client-redshift';
import { BackupClient } from '@aws-sdk/client-backup';
import { ApplicationAutoScalingClient } from '@aws-sdk/client-application-auto-scaling';
import { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { clientDefaults, COST_EXPLORER_REGION } from './config';
import { customerRoleCredentials, toSessionName } from './credentials';

export interface CustomerAccountContext {
  accountId: string;
  roleArn: string;
  externalId: string;
  /** Free-form label used to build the STS session name (e.g. the scan ID). */
  sessionLabel: string;
}

/**
 * Factory for AWS SDK clients that operate inside a customer account through the cross-account role.
 * Clients are cached per region; all share one memoized credential provider.
 */
export class CustomerAwsClients {
  readonly credentials: AwsCredentialIdentityProvider;
  private readonly cache = new Map<string, unknown>();

  constructor(
    readonly context: CustomerAccountContext,
    options: { credentials?: AwsCredentialIdentityProvider } = {},
  ) {
    this.credentials =
      options.credentials ??
      customerRoleCredentials({
        roleArn: context.roleArn,
        externalId: context.externalId,
        sessionName: toSessionName(context.sessionLabel),
      });
  }

  private get<T>(key: string, create: () => T): T {
    let client = this.cache.get(key) as T | undefined;
    if (!client) {
      client = create();
      this.cache.set(key, client);
    }
    return client;
  }

  private config(region: string) {
    return { region, credentials: this.credentials, ...clientDefaults() };
  }

  ec2(region: string): EC2Client {
    return this.get(`ec2:${region}`, () => new EC2Client(this.config(region)));
  }
  rds(region: string): RDSClient {
    return this.get(`rds:${region}`, () => new RDSClient(this.config(region)));
  }
  elbv2(region: string): ElasticLoadBalancingV2Client {
    return this.get(`elbv2:${region}`, () => new ElasticLoadBalancingV2Client(this.config(region)));
  }
  cloudwatch(region: string): CloudWatchClient {
    return this.get(`cw:${region}`, () => new CloudWatchClient(this.config(region)));
  }
  costExplorer(): CostExplorerClient {
    return this.get('ce', () => new CostExplorerClient(this.config(COST_EXPLORER_REGION)));
  }
  iam(): IAMClient {
    return this.get('iam', () => new IAMClient(this.config('us-east-1')));
  }
  sts(region = 'us-east-1'): STSClient {
    return this.get(`sts:${region}`, () => new STSClient(this.config(region)));
  }
  lambda(region: string): LambdaClient {
    return this.get(`lambda:${region}`, () => new LambdaClient(this.config(region)));
  }
  eks(region: string): EKSClient {
    return this.get(`eks:${region}`, () => new EKSClient(this.config(region)));
  }
  elasticache(region: string): ElastiCacheClient {
    return this.get(`elasticache:${region}`, () => new ElastiCacheClient(this.config(region)));
  }
  /** CloudFront is a global service; its API endpoint is in us-east-1. */
  cloudfront(): CloudFrontClient {
    return this.get('cloudfront', () => new CloudFrontClient(this.config('us-east-1')));
  }
  efs(region: string): EFSClient {
    return this.get(`efs:${region}`, () => new EFSClient(this.config(region)));
  }
  dynamodb(region: string): DynamoDBClient {
    return this.get(`dynamodb:${region}`, () => new DynamoDBClient(this.config(region)));
  }
  redshift(region: string): RedshiftClient {
    return this.get(`redshift:${region}`, () => new RedshiftClient(this.config(region)));
  }
  backup(region: string): BackupClient {
    return this.get(`backup:${region}`, () => new BackupClient(this.config(region)));
  }
  applicationAutoScaling(region: string): ApplicationAutoScalingClient {
    return this.get(`aas:${region}`, () => new ApplicationAutoScalingClient(this.config(region)));
  }
  /** Resource Groups Tagging API: batch tag lookup for services whose list APIs omit tags. */
  tagging(region: string): ResourceGroupsTaggingAPIClient {
    return this.get(`tagging:${region}`, () => new ResourceGroupsTaggingAPIClient(this.config(region)));
  }

  destroy(): void {
    for (const client of this.cache.values()) {
      (client as { destroy?: () => void }).destroy?.();
    }
    this.cache.clear();
  }
}
