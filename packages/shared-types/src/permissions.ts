/**
 * Single source of truth for the read-only permissions CloudSentry requests in customer accounts.
 * Used by the onboarding template generator (API), the documentation, and permission probes.
 * No action listed here can modify customer resources or read customer data contents.
 */
export const CUSTOMER_ROLE_PERMISSION_STATEMENTS = [
  {
    Sid: 'CloudSentryResourceDiscovery',
    Effect: 'Allow',
    Action: [
      'ec2:DescribeRegions',
      'ec2:DescribeInstances',
      'ec2:DescribeVolumes',
      'ec2:DescribeAddresses',
      'ec2:DescribeSnapshots',
      'ec2:DescribeNatGateways',
      'rds:DescribeDBInstances',
      'elasticloadbalancing:DescribeLoadBalancers',
    ],
    Resource: '*',
  },
  {
    Sid: 'CloudSentryExtendedServiceDiscovery',
    Effect: 'Allow',
    Action: [
      'lambda:ListFunctions',
      'lambda:ListProvisionedConcurrencyConfigs',
      'eks:ListClusters',
      'eks:DescribeCluster',
      'eks:ListNodegroups',
      'eks:DescribeNodegroup',
      'eks:ListFargateProfiles',
      'elasticache:DescribeCacheClusters',
      'cloudfront:ListDistributions',
      'elasticfilesystem:DescribeFileSystems',
      'elasticfilesystem:DescribeLifecycleConfiguration',
      'dynamodb:ListTables',
      'dynamodb:DescribeTable',
      'application-autoscaling:DescribeScalableTargets',
      'redshift:DescribeClusters',
      'backup:ListBackupPlans',
      'backup:GetBackupPlan',
      'backup:ListBackupVaults',
      'backup:ListRecoveryPointsByBackupVault',
      'tag:GetResources',
    ],
    Resource: '*',
  },
  {
    Sid: 'CloudSentryUtilizationMetrics',
    Effect: 'Allow',
    Action: ['cloudwatch:GetMetricData'],
    Resource: '*',
  },
  {
    Sid: 'CloudSentryCostData',
    Effect: 'Allow',
    Action: ['ce:GetCostAndUsage', 'ce:GetCostAndUsageWithResources'],
    Resource: '*',
  },
  {
    Sid: 'CloudSentryAccountMetadata',
    Effect: 'Allow',
    Action: ['iam:ListAccountAliases'],
    Resource: '*',
  },
] as const;

export const CUSTOMER_ROLE_DEFAULT_NAME = 'CloudSentryReadOnlyRole';
/** Maximum STS session duration requested (seconds). The customer role must allow at least this. */
export const CUSTOMER_ROLE_SESSION_SECONDS = 3600;
