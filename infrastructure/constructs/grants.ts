import type { ITableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement, type IGrantable } from 'aws-cdk-lib/aws-iam';
import type { IBucket } from 'aws-cdk-lib/aws-s3';

/**
 * Least-privilege grants. DynamoDB grants deliberately exclude Scan and all table-management actions:
 * every CloudSentry access pattern is a key-based GetItem/Query on a tenant partition.
 */
const TABLE_READ_ACTIONS = [
  'dynamodb:GetItem',
  'dynamodb:BatchGetItem',
  'dynamodb:Query',
  'dynamodb:ConditionCheckItem',
];
const TABLE_WRITE_ACTIONS = [
  'dynamodb:PutItem',
  'dynamodb:UpdateItem',
  'dynamodb:DeleteItem',
  'dynamodb:BatchWriteItem',
];

/** Prefixes under which tenant scan artifacts and reports live (see ARTIFACT_KEYS in shared-types). */
export const SCAN_ARTIFACT_PREFIX = 'scans/';
export const REPORT_PREFIX = 'reports/';
export const ARTIFACT_PREFIXES = [SCAN_ARTIFACT_PREFIX, REPORT_PREFIX] as const;

function tableResources(table: ITableV2): string[] {
  return [table.tableArn, `${table.tableArn}/index/*`];
}

export function grantTableRead(grantee: IGrantable, table: ITableV2): void {
  grantee.grantPrincipal.addToPrincipalPolicy(
    new PolicyStatement({ actions: TABLE_READ_ACTIONS, resources: tableResources(table) }),
  );
}

export function grantTableReadWrite(grantee: IGrantable, table: ITableV2): void {
  grantee.grantPrincipal.addToPrincipalPolicy(
    new PolicyStatement({
      actions: [...TABLE_READ_ACTIONS, ...TABLE_WRITE_ACTIONS],
      resources: tableResources(table),
    }),
  );
}

/**
 * Read access to tenant artifacts. s3:ListBucket is included so that HeadObject/GetObject on a missing
 * key returns 404 (NotFound) instead of 403, which the artifact store relies on.
 */
export function grantArtifactsRead(grantee: IGrantable, bucket: IBucket): void {
  grantee.grantPrincipal.addToPrincipalPolicy(
    new PolicyStatement({
      actions: ['s3:GetObject'],
      resources: ARTIFACT_PREFIXES.map((p) => bucket.arnForObjects(`${p}*`)),
    }),
  );
  grantee.grantPrincipal.addToPrincipalPolicy(
    new PolicyStatement({ actions: ['s3:ListBucket'], resources: [bucket.bucketArn] }),
  );
}

export function grantArtifactsWrite(grantee: IGrantable, bucket: IBucket): void {
  grantee.grantPrincipal.addToPrincipalPolicy(
    new PolicyStatement({
      actions: ['s3:PutObject'],
      resources: ARTIFACT_PREFIXES.map((p) => bucket.arnForObjects(`${p}*`)),
    }),
  );
}

export function grantArtifactsReadWrite(grantee: IGrantable, bucket: IBucket): void {
  grantArtifactsRead(grantee, bucket);
  grantArtifactsWrite(grantee, bucket);
}

/** Allows publishing custom metrics, restricted to the CloudSentry namespace. */
export function grantPutCloudSentryMetrics(grantee: IGrantable): void {
  grantee.grantPrincipal.addToPrincipalPolicy(
    new PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
      conditions: { StringEquals: { 'cloudwatch:namespace': 'CloudSentry' } },
    }),
  );
}
