import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import { isAwsErrorNamed } from '@cloudsentry/utilities';

/**
 * Creates the single table (with GSI1 and TTL) in DynamoDB Local. For local development and
 * integration tests only — deployed tables are created by the CDK DataStack.
 */
export async function ensureLocalTable(endpoint: string, tableName: string): Promise<void> {
  const client = new DynamoDBClient({
    endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return;
  } catch (error) {
    if (!isAwsErrorNamed(error, 'ResourceNotFoundException')) throw error;
  }
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  try {
    await client.send(
      new UpdateTimeToLiveCommand({
        TableName: tableName,
        TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      }),
    );
  } catch {
    // DynamoDB Local accepts but does not enforce TTL; repositories also check expiry on read.
  }
  client.destroy();
}
