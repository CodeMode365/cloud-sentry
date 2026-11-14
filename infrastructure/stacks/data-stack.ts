import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { AttributeType, Billing, TableEncryptionV2, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
  StorageClass,
} from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { REPORT_PREFIX, SCAN_ARTIFACT_PREFIX } from '../constructs/grants';
import { resourcePrefix, type EnvironmentConfig } from '../environments';

export interface DataStackProps extends StackProps {
  config: EnvironmentConfig;
}

/**
 * Persistence layer: the single DynamoDB table (design in docs/architecture/overview.md section 3)
 * and the private artifacts bucket for scan artifacts and reports.
 */
export class DataStack extends Stack {
  readonly table: TableV2;
  readonly artifactsBucket: Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config } = props;
    const prefix = resourcePrefix(config);

    this.table = new TableV2(this, 'MainTable', {
      tableName: `${prefix}-main`,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billing: Billing.onDemand(),
      encryption: TableEncryptionV2.awsManagedKey(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: config.pointInTimeRecovery },
      deletionProtection: config.deletionProtection,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: config.removalPolicy,
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: AttributeType.STRING },
        },
      ],
    });

    // Scan artifacts (scans/) and reports (reports/) have separate top-level prefixes (ARTIFACT_KEYS in
    // shared-types) so each gets its own retention period.
    const destroy = config.removalPolicy === RemovalPolicy.DESTROY;
    this.artifactsBucket = new Bucket(this, 'ArtifactsBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      versioned: false,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: config.removalPolicy,
      autoDeleteObjects: destroy,
      lifecycleRules: [
        {
          id: 'expire-reports',
          prefix: REPORT_PREFIX,
          expiration: Duration.days(config.artifacts.reportRetentionDays),
        },
        {
          id: 'expire-scan-artifacts',
          prefix: SCAN_ARTIFACT_PREFIX,
          expiration: Duration.days(config.artifacts.retentionDays),
          abortIncompleteMultipartUploadAfter: Duration.days(7),
          ...(config.artifacts.infrequentAccessAfterDays !== undefined &&
          config.artifacts.infrequentAccessAfterDays < config.artifacts.retentionDays
            ? {
                transitions: [
                  {
                    storageClass: StorageClass.INFREQUENT_ACCESS,
                    transitionAfter: Duration.days(config.artifacts.infrequentAccessAfterDays),
                  },
                ],
              }
            : {}),
        },
        { id: 'abort-incomplete-uploads', abortIncompleteMultipartUploadAfter: Duration.days(7) },
      ],
    });

    new CfnOutput(this, 'TableName', { value: this.table.tableName, exportName: `${prefix}-table-name` });
    new CfnOutput(this, 'ArtifactsBucketName', {
      value: this.artifactsBucket.bucketName,
      exportName: `${prefix}-artifacts-bucket`,
    });
  }
}
