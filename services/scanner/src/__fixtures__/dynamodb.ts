/** SYNTHETIC TEST FIXTURE: SDK-shaped DynamoDB and Application Auto Scaling responses. Not real AWS data. */
import type { DescribeScalableTargetsCommandOutput } from '@aws-sdk/client-application-auto-scaling';
import type { DescribeTableCommandOutput, ListTablesCommandOutput } from '@aws-sdk/client-dynamodb';

export const tablesPage1: Partial<ListTablesCommandOutput> = {
  TableNames: ['orders'],
  LastEvaluatedTableName: 'orders',
};

export const tablesPage2: Partial<ListTablesCommandOutput> = {
  TableNames: ['events', 'sessions', 'gone'],
};

/** Provisioned table created before on-demand existed (no BillingModeSummary), with two GSIs. */
export const ordersTable: Partial<DescribeTableCommandOutput> = {
  Table: {
    TableName: 'orders',
    TableArn: 'arn:aws:dynamodb:us-east-1:111122223333:table/orders',
    TableStatus: 'ACTIVE',
    CreationDateTime: new Date('2024-01-01T00:00:00Z'),
    ProvisionedThroughput: { ReadCapacityUnits: 100, WriteCapacityUnits: 50 },
    TableSizeBytes: 53687091200,
    ItemCount: 1200000,
    GlobalSecondaryIndexes: [
      { IndexName: 'by-customer', ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 5 } },
      { IndexName: 'by-status', ProvisionedThroughput: { ReadCapacityUnits: 20, WriteCapacityUnits: 5 } },
    ],
    TableClassSummary: { TableClass: 'STANDARD_INFREQUENT_ACCESS' },
    DeletionProtectionEnabled: true,
    Replicas: [{ RegionName: 'us-east-1' }, { RegionName: 'eu-west-1' }],
  },
};

export const eventsTable: Partial<DescribeTableCommandOutput> = {
  Table: {
    TableName: 'events',
    TableArn: 'arn:aws:dynamodb:us-east-1:111122223333:table/events',
    TableStatus: 'ACTIVE',
    CreationDateTime: new Date('2026-06-01T00:00:00Z'),
    BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' },
    ProvisionedThroughput: { ReadCapacityUnits: 0, WriteCapacityUnits: 0, NumberOfDecreasesToday: 0 },
    TableSizeBytes: 1024,
    ItemCount: 3,
  },
};

export const scalableTargetsPage1: Partial<DescribeScalableTargetsCommandOutput> = {
  NextToken: 'targets-2',
  ScalableTargets: [
    {
      ServiceNamespace: 'dynamodb',
      ResourceId: 'table/orders',
      ScalableDimension: 'dynamodb:table:ReadCapacityUnits',
      MinCapacity: 5,
      MaxCapacity: 500,
      RoleARN: 'arn:aws:iam::111122223333:role/fixture-aas',
      CreationTime: new Date('2024-01-02T00:00:00Z'),
    },
  ],
};

export const scalableTargetsPage2: Partial<DescribeScalableTargetsCommandOutput> = {
  ScalableTargets: [
    {
      ServiceNamespace: 'dynamodb',
      // GSI target: does not count as table-level auto scaling.
      ResourceId: 'table/events/index/by-type',
      ScalableDimension: 'dynamodb:index:ReadCapacityUnits',
      MinCapacity: 1,
      MaxCapacity: 10,
      RoleARN: 'arn:aws:iam::111122223333:role/fixture-aas',
      CreationTime: new Date('2026-06-02T00:00:00Z'),
    },
  ],
};
