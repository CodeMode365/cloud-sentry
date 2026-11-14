import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the monorepo root (infrastructure/..). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export type FunctionGroup = 'workflow' | 'api' | 'report';
export type MemoryClass = 'standard' | 'large';

export interface HandlerDefinition {
  /** Function id; physical name is cloudsentry-<stage>-<id>. */
  id: string;
  /** Entry file relative to the repository root. Must export `handler`. */
  entry: string;
  group: FunctionGroup;
  description: string;
  timeoutSeconds: number;
  memory: MemoryClass;
}

/**
 * Lambda handler manifest. Mirrors docs/architecture/overview.md section 4 - keep both in sync.
 */
export const HANDLERS = {
  // ---- Scan workflow (Step Functions tasks) ----
  validateAccount: {
    id: 'validate-account',
    entry: 'services/scanner/src/handlers/validate-account.ts',
    group: 'workflow',
    description: 'Scan workflow: load account, mark scan RUNNING',
    timeoutSeconds: 30,
    memory: 'standard',
  },
  assumeRole: {
    id: 'assume-role',
    entry: 'services/scanner/src/handlers/assume-role.ts',
    group: 'workflow',
    description: 'Scan workflow: verify the customer role can be assumed (returns no credentials)',
    timeoutSeconds: 60,
    memory: 'standard',
  },
  resolveRegions: {
    id: 'resolve-regions',
    entry: 'services/scanner/src/handlers/resolve-regions.ts',
    group: 'workflow',
    description: 'Scan workflow: intersect configured and enabled regions',
    timeoutSeconds: 60,
    memory: 'standard',
  },
  discoverEc2: {
    id: 'discover-ec2',
    entry: 'services/scanner/src/handlers/discover-ec2.ts',
    group: 'workflow',
    description: 'Discovery worker: EC2 instances',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  discoverEbs: {
    id: 'discover-ebs',
    entry: 'services/scanner/src/handlers/discover-ebs.ts',
    group: 'workflow',
    description: 'Discovery worker: EBS volumes',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  discoverEip: {
    id: 'discover-eip',
    entry: 'services/scanner/src/handlers/discover-eip.ts',
    group: 'workflow',
    description: 'Discovery worker: Elastic IP addresses',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  discoverRds: {
    id: 'discover-rds',
    entry: 'services/scanner/src/handlers/discover-rds.ts',
    group: 'workflow',
    description: 'Discovery worker: RDS DB instances',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  discoverSnapshots: {
    id: 'discover-snapshots',
    entry: 'services/scanner/src/handlers/discover-snapshots.ts',
    group: 'workflow',
    description: 'Discovery worker: EBS snapshots (owned by the account)',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  discoverNatGateways: {
    id: 'discover-nat-gateways',
    entry: 'services/scanner/src/handlers/discover-nat-gateways.ts',
    group: 'workflow',
    description: 'Discovery worker: NAT gateways',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  discoverLoadBalancers: {
    id: 'discover-load-balancers',
    entry: 'services/scanner/src/handlers/discover-load-balancers.ts',
    group: 'workflow',
    description: 'Discovery worker: Elastic Load Balancing v2 load balancers',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  discoverLambdaFunctions: {
    id: 'discover-lambda-functions',
    entry: 'services/scanner/src/handlers/discover-lambda-functions.ts',
    group: 'workflow',
    description: 'Discovery worker: Lambda functions and provisioned concurrency',
    timeoutSeconds: 600,
    memory: 'standard',
  },
  discoverEksClusters: {
    id: 'discover-eks-clusters',
    entry: 'services/scanner/src/handlers/discover-eks-clusters.ts',
    group: 'workflow',
    description: 'Discovery worker: EKS clusters and node groups',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  discoverElastiCacheClusters: {
    id: 'discover-elasticache-clusters',
    entry: 'services/scanner/src/handlers/discover-elasticache-clusters.ts',
    group: 'workflow',
    description: 'Discovery worker: ElastiCache cache clusters',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  discoverCloudFrontDistributions: {
    id: 'discover-cloudfront-distributions',
    entry: 'services/scanner/src/handlers/discover-cloudfront-distributions.ts',
    group: 'workflow',
    description: 'Discovery worker: CloudFront distributions (global)',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  discoverEfsFileSystems: {
    id: 'discover-efs-file-systems',
    entry: 'services/scanner/src/handlers/discover-efs-file-systems.ts',
    group: 'workflow',
    description: 'Discovery worker: EFS file systems and lifecycle configuration',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  discoverDynamoDbTables: {
    id: 'discover-dynamodb-tables',
    entry: 'services/scanner/src/handlers/discover-dynamodb-tables.ts',
    group: 'workflow',
    description: 'Discovery worker: DynamoDB tables and auto scaling targets',
    timeoutSeconds: 600,
    memory: 'standard',
  },
  discoverRedshiftClusters: {
    id: 'discover-redshift-clusters',
    entry: 'services/scanner/src/handlers/discover-redshift-clusters.ts',
    group: 'workflow',
    description: 'Discovery worker: Redshift provisioned clusters',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  discoverBackupPlans: {
    id: 'discover-backup-plans',
    entry: 'services/scanner/src/handlers/discover-backup-plans.ts',
    group: 'workflow',
    description: 'Discovery worker: AWS Backup plans',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  discoverBackupVaults: {
    id: 'discover-backup-vaults',
    entry: 'services/scanner/src/handlers/discover-backup-vaults.ts',
    group: 'workflow',
    description: 'Discovery worker: AWS Backup vaults and recovery point summaries',
    timeoutSeconds: 600,
    memory: 'standard',
  },
  collectMetrics: {
    id: 'collect-metrics',
    entry: 'services/scanner/src/handlers/collect-metrics.ts',
    group: 'workflow',
    description: 'Scan workflow: CloudWatch GetMetricData utilization collection',
    timeoutSeconds: 900,
    memory: 'large',
  },
  analyzeCosts: {
    id: 'analyze-costs',
    entry: 'services/scanner/src/handlers/analyze-costs.ts',
    group: 'workflow',
    description: 'Scan workflow: Cost Explorer spend analysis',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  normalizeResources: {
    id: 'normalize-resources',
    entry: 'services/scanner/src/handlers/normalize-resources.ts',
    group: 'workflow',
    description: 'Scan workflow: merge discovery and metrics into normalized resources',
    timeoutSeconds: 300,
    memory: 'large',
  },
  executeDetectionRules: {
    id: 'execute-detection-rules',
    entry: 'services/analyzer/src/handlers/execute-detection-rules.ts',
    group: 'workflow',
    description: 'Scan workflow: deterministic waste detection rules',
    timeoutSeconds: 300,
    memory: 'large',
  },
  generateRecommendations: {
    id: 'generate-recommendations',
    entry: 'services/recommendation/src/handlers/generate-recommendations.ts',
    group: 'workflow',
    description: 'Scan workflow: convert detected issues into recommendations',
    timeoutSeconds: 300,
    memory: 'standard',
  },
  estimateSavings: {
    id: 'estimate-savings',
    entry: 'services/recommendation/src/handlers/estimate-savings.ts',
    group: 'workflow',
    description: 'Scan workflow: price savings with the AWS Price List API',
    timeoutSeconds: 600,
    memory: 'standard',
  },
  persistResults: {
    id: 'persist-results',
    entry: 'services/scanner/src/handlers/persist-results.ts',
    group: 'workflow',
    description: 'Scan workflow: persist resources, findings and recommendations (idempotent per scan)',
    timeoutSeconds: 600,
    memory: 'large',
  },
  generateSummary: {
    id: 'generate-summary',
    entry: 'services/scanner/src/handlers/generate-summary.ts',
    group: 'workflow',
    description: 'Scan workflow: compute summary, final status, release lock',
    timeoutSeconds: 120,
    memory: 'standard',
  },
  sendNotifications: {
    id: 'send-notifications',
    entry: 'services/scanner/src/handlers/send-notifications.ts',
    group: 'workflow',
    description: 'Scan workflow: deduplicated SNS notifications',
    timeoutSeconds: 120,
    memory: 'standard',
  },
  markScanFailed: {
    id: 'mark-scan-failed',
    entry: 'services/scanner/src/handlers/mark-scan-failed.ts',
    group: 'workflow',
    description: 'Scan workflow: global failure handler',
    timeoutSeconds: 60,
    memory: 'standard',
  },
  scheduledScanTrigger: {
    id: 'scheduled-scan-trigger',
    entry: 'services/scanner/src/handlers/scheduled-scan-trigger.ts',
    group: 'workflow',
    description: 'EventBridge Scheduler target: starts scheduled scans',
    timeoutSeconds: 60,
    memory: 'standard',
  },
  // ---- API domains ----
  apiAuth: {
    id: 'api-auth',
    entry: 'services/api/src/handlers/auth.ts',
    group: 'api',
    description: 'API: /auth',
    timeoutSeconds: 15,
    memory: 'standard',
  },
  apiAccounts: {
    id: 'api-accounts',
    entry: 'services/api/src/handlers/accounts.ts',
    group: 'api',
    description: 'API: /accounts',
    timeoutSeconds: 30,
    memory: 'standard',
  },
  apiScans: {
    id: 'api-scans',
    entry: 'services/api/src/handlers/scans.ts',
    group: 'api',
    description: 'API: /scans and POST /accounts/{accountId}/scans',
    timeoutSeconds: 15,
    memory: 'standard',
  },
  apiInventory: {
    id: 'api-inventory',
    entry: 'services/api/src/handlers/inventory.ts',
    group: 'api',
    description: 'API: /resources, /findings, /recommendations',
    timeoutSeconds: 15,
    memory: 'standard',
  },
  apiAnalytics: {
    id: 'api-analytics',
    entry: 'services/api/src/handlers/analytics.ts',
    group: 'api',
    description: 'API: /analytics',
    timeoutSeconds: 15,
    memory: 'standard',
  },
  apiSchedules: {
    id: 'api-schedules',
    entry: 'services/api/src/handlers/schedules.ts',
    group: 'api',
    description: 'API: /schedules',
    timeoutSeconds: 15,
    memory: 'standard',
  },
  apiReports: {
    id: 'api-reports',
    entry: 'services/api/src/handlers/reports.ts',
    group: 'api',
    description: 'API: /reports',
    timeoutSeconds: 15,
    memory: 'standard',
  },
  apiSettings: {
    id: 'api-settings',
    entry: 'services/api/src/handlers/settings.ts',
    group: 'api',
    description: 'API: /settings and /rules',
    timeoutSeconds: 15,
    memory: 'standard',
  },
  // ---- Reporting ----
  generateReport: {
    id: 'generate-report',
    entry: 'services/reporting/src/handlers/generate-report.ts',
    group: 'report',
    description: 'Generates PDF/JSON reports into the artifacts bucket',
    timeoutSeconds: 300,
    memory: 'large',
  },
} as const satisfies Record<string, HandlerDefinition>;

export type HandlerKey = keyof typeof HANDLERS;

export function handlerEntryPath(definition: HandlerDefinition): string {
  return join(REPO_ROOT, definition.entry);
}

export function missingHandlerEntries(): string[] {
  return Object.values(HANDLERS)
    .filter((h) => !existsSync(handlerEntryPath(h)))
    .map((h) => h.entry);
}

export function allHandlerEntriesExist(): boolean {
  return missingHandlerEntries().length === 0;
}

export function functionName(stage: string, definition: Pick<HandlerDefinition, 'id'>): string {
  return `cloudsentry-${stage}-${definition.id}`;
}
