import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import type { ITableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Alias } from 'aws-cdk-lib/aws-kms';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { IBucket } from 'aws-cdk-lib/aws-s3';
import { ScheduleGroup } from 'aws-cdk-lib/aws-scheduler';
import { Topic } from 'aws-cdk-lib/aws-sns';
import type { StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import type { Construct } from 'constructs';
import { CloudSentryFunction, type SharedFunctionEnvironment } from '../constructs/cloudsentry-function';
import {
  grantArtifactsRead,
  grantArtifactsReadWrite,
  grantArtifactsWrite,
  grantPutCloudSentryMetrics,
  grantTableReadWrite,
} from '../constructs/grants';
import { HANDLERS, type HandlerKey } from '../constructs/handlers';
import { resourcePrefix, type EnvironmentConfig } from '../environments';
import { customerAssumeRoleStatement, pricingStatement } from '../policies/statements';
import { ScanStateMachine } from '../workflows/scan-state-machine';

export interface WorkflowStackProps extends StackProps {
  config: EnvironmentConfig;
  table: ITableV2;
  artifactsBucket: IBucket;
}

type WorkflowHandlerKey = Extract<
  HandlerKey,
  | 'validateAccount'
  | 'assumeRole'
  | 'resolveRegions'
  | 'discoverEc2'
  | 'discoverEbs'
  | 'discoverEip'
  | 'discoverRds'
  | 'discoverSnapshots'
  | 'discoverNatGateways'
  | 'discoverLoadBalancers'
  | 'discoverLambdaFunctions'
  | 'discoverEksClusters'
  | 'discoverElastiCacheClusters'
  | 'discoverCloudFrontDistributions'
  | 'discoverEfsFileSystems'
  | 'discoverDynamoDbTables'
  | 'discoverRedshiftClusters'
  | 'discoverBackupPlans'
  | 'discoverBackupVaults'
  | 'collectMetrics'
  | 'analyzeCosts'
  | 'normalizeResources'
  | 'executeDetectionRules'
  | 'generateRecommendations'
  | 'estimateSavings'
  | 'persistResults'
  | 'generateSummary'
  | 'sendNotifications'
  | 'markScanFailed'
  | 'scheduledScanTrigger'
>;

/** Per-function access profile. Everything not listed is denied. */
interface AccessProfile {
  customerAccess?: boolean;
  artifacts?: 'read' | 'write' | 'readwrite';
  pricing?: boolean;
  publishNotifications?: boolean;
  startScans?: boolean;
  environment?: Record<string, string>;
}

/**
 * Orchestration layer: scan workflow Lambdas, the Step Functions state machine, the notifications topic,
 * and the EventBridge Scheduler group/role used for scheduled scans.
 */
export class WorkflowStack extends Stack {
  readonly functions: Record<WorkflowHandlerKey, NodejsFunction>;
  readonly stateMachine: StateMachine;
  readonly stateMachineName: string;
  readonly notificationsTopic: Topic;
  readonly scheduleGroup: ScheduleGroup;
  readonly schedulerRole: Role;

  constructor(scope: Construct, id: string, props: WorkflowStackProps) {
    super(scope, id, props);
    const { config, table, artifactsBucket } = props;
    const prefix = resourcePrefix(config);
    this.stateMachineName = `${prefix}-scan`;

    this.notificationsTopic = new Topic(this, 'NotificationsTopic', {
      topicName: `${prefix}-notifications`,
      displayName: 'CloudSentry',
      masterKey: Alias.fromAliasName(this, 'SnsManagedKey', 'alias/aws/sns'),
      enforceSSL: true,
    });

    const shared: SharedFunctionEnvironment = {
      TABLE_NAME: table.tableName,
      ARTIFACTS_BUCKET: artifactsBucket.bucketName,
      PLATFORM_ACCOUNT_ID: this.account,
    };

    const profiles: Record<WorkflowHandlerKey, AccessProfile> = {
      validateAccount: {},
      assumeRole: { customerAccess: true },
      resolveRegions: { customerAccess: true },
      discoverEc2: { customerAccess: true, artifacts: 'write' },
      discoverEbs: { customerAccess: true, artifacts: 'write' },
      discoverEip: { customerAccess: true, artifacts: 'write' },
      discoverRds: { customerAccess: true, artifacts: 'write' },
      discoverSnapshots: { customerAccess: true, artifacts: 'write' },
      discoverNatGateways: { customerAccess: true, artifacts: 'write' },
      discoverLoadBalancers: { customerAccess: true, artifacts: 'write' },
      discoverLambdaFunctions: { customerAccess: true, artifacts: 'write' },
      discoverEksClusters: { customerAccess: true, artifacts: 'write' },
      discoverElastiCacheClusters: { customerAccess: true, artifacts: 'write' },
      discoverCloudFrontDistributions: { customerAccess: true, artifacts: 'write' },
      discoverEfsFileSystems: { customerAccess: true, artifacts: 'write' },
      discoverDynamoDbTables: { customerAccess: true, artifacts: 'write' },
      discoverRedshiftClusters: { customerAccess: true, artifacts: 'write' },
      discoverBackupPlans: { customerAccess: true, artifacts: 'write' },
      discoverBackupVaults: { customerAccess: true, artifacts: 'write' },
      collectMetrics: {
        customerAccess: true,
        artifacts: 'readwrite',
        environment: { METRICS_REUSE_HOURS: String(config.workers.metricsReuseHours) },
      },
      analyzeCosts: {
        customerAccess: true,
        artifacts: 'readwrite',
        environment: { COST_REFRESH_HOURS: String(config.workers.costRefreshHours) },
      },
      normalizeResources: { artifacts: 'readwrite' },
      executeDetectionRules: { artifacts: 'readwrite' },
      generateRecommendations: { artifacts: 'readwrite' },
      estimateSavings: {
        artifacts: 'readwrite',
        pricing: true,
        environment: { PRICING_REGION: 'us-east-1' },
      },
      persistResults: { artifacts: 'read' },
      generateSummary: { artifacts: 'readwrite' },
      sendNotifications: {
        artifacts: 'read',
        publishNotifications: true,
        environment: {
          NOTIFICATIONS_TOPIC_ARN: this.notificationsTopic.topicArn,
          ...(config.dashboardUrl ? { DASHBOARD_URL: config.dashboardUrl } : {}),
        },
      },
      markScanFailed: {},
      scheduledScanTrigger: { startScans: true },
    };

    const fns = {} as Record<WorkflowHandlerKey, NodejsFunction>;
    for (const key of Object.keys(profiles) as WorkflowHandlerKey[]) {
      const profile = profiles[key];
      const fn = new CloudSentryFunction(this, key, {
        definition: HANDLERS[key],
        config,
        shared,
        ...(profile.environment ? { environment: profile.environment } : {}),
      }).fn;
      // Every workflow step reads the account/scan records and updates scan progress.
      grantTableReadWrite(fn, table);
      grantPutCloudSentryMetrics(fn);
      if (profile.customerAccess) fn.addToRolePolicy(customerAssumeRoleStatement());
      if (profile.artifacts === 'read') grantArtifactsRead(fn, artifactsBucket);
      if (profile.artifacts === 'write') grantArtifactsWrite(fn, artifactsBucket);
      if (profile.artifacts === 'readwrite') grantArtifactsReadWrite(fn, artifactsBucket);
      if (profile.pricing) fn.addToRolePolicy(pricingStatement());
      if (profile.publishNotifications) this.notificationsTopic.grantPublish(fn);
      fns[key] = fn;
    }
    this.functions = fns;

    const machine = new ScanStateMachine(this, 'ScanWorkflow', {
      stateMachineName: this.stateMachineName,
      logRetention: config.logRetention,
      removalPolicy: config.removalPolicy,
      functions: {
        validateAccount: fns.validateAccount,
        assumeRole: fns.assumeRole,
        resolveRegions: fns.resolveRegions,
        collectMetrics: fns.collectMetrics,
        analyzeCosts: fns.analyzeCosts,
        normalizeResources: fns.normalizeResources,
        executeDetectionRules: fns.executeDetectionRules,
        generateRecommendations: fns.generateRecommendations,
        estimateSavings: fns.estimateSavings,
        persistResults: fns.persistResults,
        generateSummary: fns.generateSummary,
        sendNotifications: fns.sendNotifications,
        markScanFailed: fns.markScanFailed,
      },
      discovery: [
        { stateName: 'EC2Discovery', resourceType: 'EC2_INSTANCE', fn: fns.discoverEc2 },
        { stateName: 'EBSDiscovery', resourceType: 'EBS_VOLUME', fn: fns.discoverEbs },
        { stateName: 'RDSDiscovery', resourceType: 'RDS_INSTANCE', fn: fns.discoverRds },
        { stateName: 'EIPDiscovery', resourceType: 'ELASTIC_IP', fn: fns.discoverEip },
        { stateName: 'SnapshotDiscovery', resourceType: 'EBS_SNAPSHOT', fn: fns.discoverSnapshots },
        { stateName: 'NATGatewayDiscovery', resourceType: 'NAT_GATEWAY', fn: fns.discoverNatGateways },
        { stateName: 'LoadBalancerDiscovery', resourceType: 'LOAD_BALANCER', fn: fns.discoverLoadBalancers },
        { stateName: 'LambdaDiscovery', resourceType: 'LAMBDA_FUNCTION', fn: fns.discoverLambdaFunctions },
        { stateName: 'EKSDiscovery', resourceType: 'EKS_CLUSTER', fn: fns.discoverEksClusters },
        { stateName: 'ElastiCacheDiscovery', resourceType: 'ELASTICACHE_CLUSTER', fn: fns.discoverElastiCacheClusters },
        { stateName: 'CloudFrontDiscovery', resourceType: 'CLOUDFRONT_DISTRIBUTION', fn: fns.discoverCloudFrontDistributions },
        { stateName: 'EFSDiscovery', resourceType: 'EFS_FILE_SYSTEM', fn: fns.discoverEfsFileSystems },
        { stateName: 'DynamoDBDiscovery', resourceType: 'DYNAMODB_TABLE', fn: fns.discoverDynamoDbTables },
        { stateName: 'RedshiftDiscovery', resourceType: 'REDSHIFT_CLUSTER', fn: fns.discoverRedshiftClusters },
        { stateName: 'BackupPlanDiscovery', resourceType: 'BACKUP_PLAN', fn: fns.discoverBackupPlans },
        { stateName: 'BackupVaultDiscovery', resourceType: 'BACKUP_VAULT', fn: fns.discoverBackupVaults },
      ],
    });
    this.stateMachine = machine.stateMachine;

    // The scheduled trigger starts executions through the same ScanService path as manual scans.
    this.stateMachine.grantStartExecution(fns.scheduledScanTrigger);
    fns.scheduledScanTrigger.addEnvironment('STATE_MACHINE_ARN', this.stateMachine.stateMachineArn);

    // ---- EventBridge Scheduler ----
    this.scheduleGroup = new ScheduleGroup(this, 'ScanScheduleGroup', {
      scheduleGroupName: prefix,
      removalPolicy: config.removalPolicy,
    });

    // Execution role assumed by EventBridge Scheduler. Confused-deputy protection: only schedules in this
    // account's CloudSentry schedule group may assume it, and it can only invoke the trigger function.
    this.schedulerRole = new Role(this, 'SchedulerExecutionRole', {
      roleName: `${prefix}-scheduler`,
      description: 'Assumed by EventBridge Scheduler to invoke the CloudSentry scheduled-scan trigger',
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: { 'aws:SourceArn': this.scheduleGroup.scheduleGroupArn },
        },
      }),
    });
    this.schedulerRole.addToPolicy(
      new PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [fns.scheduledScanTrigger.functionArn, `${fns.scheduledScanTrigger.functionArn}:*`],
      }),
    );

    new CfnOutput(this, 'StateMachineArn', {
      value: this.stateMachine.stateMachineArn,
      exportName: `${prefix}-state-machine-arn`,
    });
    new CfnOutput(this, 'NotificationsTopicArn', { value: this.notificationsTopic.topicArn });
    new CfnOutput(this, 'ScheduleGroupName', { value: this.scheduleGroup.scheduleGroupName });
    new CfnOutput(this, 'PlatformAccountId', {
      value: this.account,
      description: 'Customers trust this account (PLATFORM_ACCOUNT_ID) in their CloudSentry role',
    });
  }
}
