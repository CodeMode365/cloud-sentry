import type { CustomerAwsClients } from '@cloudsentry/aws-clients';
import type { DiscoveredResource, ResourceType } from '@cloudsentry/shared-types';
import type { DiscoveryContext } from './common';
import { discoverEc2Instances } from './ec2';
import { discoverEbsVolumes } from './ebs';
import { discoverElasticIps } from './eip';
import { discoverRdsInstances } from './rds';
import { discoverSnapshots } from './snapshots';
import { discoverNatGateways } from './nat-gateways';
import { discoverLoadBalancers } from './load-balancers';
import { discoverLambdaFunctions } from './lambda-functions';
import { discoverEksClusters } from './eks-clusters';
import { discoverElastiCacheClusters } from './elasticache-clusters';
import { discoverCloudFrontDistributions } from './cloudfront-distributions';
import { discoverEfsFileSystems } from './efs-file-systems';
import { discoverDynamoDbTables } from './dynamodb-tables';
import { discoverRedshiftClusters } from './redshift-clusters';
import { discoverBackupPlans } from './backup-plans';
import { discoverBackupVaults } from './backup-vaults';

/** Subset of CustomerAwsClients used by discovery; lets tests pass plain mocked clients. */
export type DiscoveryClients = Pick<
  CustomerAwsClients,
  | 'ec2'
  | 'rds'
  | 'elbv2'
  | 'lambda'
  | 'eks'
  | 'elasticache'
  | 'cloudfront'
  | 'efs'
  | 'dynamodb'
  | 'redshift'
  | 'backup'
  | 'applicationAutoScaling'
  | 'tagging'
>;

export type DiscoveryModule = (
  clients: DiscoveryClients,
  ctx: DiscoveryContext,
) => Promise<DiscoveredResource[]>;

/**
 * One discovery module per resource type. Global types (GLOBAL_RESOURCE_TYPES) are invoked once per
 * scan with region `global`; their module picks the global client itself.
 */
export const DISCOVERY_MODULES: Record<ResourceType, DiscoveryModule> = {
  EC2_INSTANCE: (c, ctx) => discoverEc2Instances(c.ec2(ctx.region), ctx),
  EBS_VOLUME: (c, ctx) => discoverEbsVolumes(c.ec2(ctx.region), ctx),
  ELASTIC_IP: (c, ctx) => discoverElasticIps(c.ec2(ctx.region), ctx),
  RDS_INSTANCE: (c, ctx) => discoverRdsInstances(c.rds(ctx.region), ctx),
  EBS_SNAPSHOT: (c, ctx) => discoverSnapshots(c.ec2(ctx.region), ctx),
  NAT_GATEWAY: (c, ctx) => discoverNatGateways(c.ec2(ctx.region), ctx),
  LOAD_BALANCER: (c, ctx) => discoverLoadBalancers(c.elbv2(ctx.region), ctx),
  LAMBDA_FUNCTION: (c, ctx) => discoverLambdaFunctions(c.lambda(ctx.region), c.tagging(ctx.region), ctx),
  EKS_CLUSTER: (c, ctx) => discoverEksClusters(c.eks(ctx.region), ctx),
  ELASTICACHE_CLUSTER: (c, ctx) =>
    discoverElastiCacheClusters(c.elasticache(ctx.region), c.tagging(ctx.region), ctx),
  CLOUDFRONT_DISTRIBUTION: (c, ctx) => discoverCloudFrontDistributions(c.cloudfront(), ctx),
  EFS_FILE_SYSTEM: (c, ctx) => discoverEfsFileSystems(c.efs(ctx.region), ctx),
  DYNAMODB_TABLE: (c, ctx) =>
    discoverDynamoDbTables(
      c.dynamodb(ctx.region),
      c.applicationAutoScaling(ctx.region),
      c.tagging(ctx.region),
      ctx,
    ),
  REDSHIFT_CLUSTER: (c, ctx) => discoverRedshiftClusters(c.redshift(ctx.region), ctx),
  BACKUP_PLAN: (c, ctx) => discoverBackupPlans(c.backup(ctx.region), ctx),
  BACKUP_VAULT: (c, ctx) => discoverBackupVaults(c.backup(ctx.region), ctx),
};
