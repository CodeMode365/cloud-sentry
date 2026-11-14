import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  ApplicationAutoScalingClient,
  DescribeScalableTargetsCommand,
} from '@aws-sdk/client-application-auto-scaling';
import { DescribeTableCommand, DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from '@aws-sdk/client-resource-groups-tagging-api';
import {
  eventsTable,
  ordersTable,
  scalableTargetsPage1,
  scalableTargetsPage2,
  tablesPage1,
  tablesPage2,
} from '../__fixtures__/dynamodb';
import { discoverDynamoDbTables } from './dynamodb-tables';
import { awsError, captureLogger, warnings } from './test-helpers';

const ddbMock = mockClient(DynamoDBClient);
const aasMock = mockClient(ApplicationAutoScalingClient);
const taggingMock = mockClient(ResourceGroupsTaggingAPIClient);

const run = (logger = captureLogger().logger) =>
  discoverDynamoDbTables(
    new DynamoDBClient({ region: 'us-east-1' }),
    new ApplicationAutoScalingClient({ region: 'us-east-1' }),
    new ResourceGroupsTaggingAPIClient({ region: 'us-east-1' }),
    { accountId: '111122223333', region: 'us-east-1', logger },
  );

beforeEach(() => {
  ddbMock.reset();
  aasMock.reset();
  taggingMock.reset();
});

function mockTables() {
  ddbMock.on(ListTablesCommand).resolvesOnce(tablesPage1).resolvesOnce(tablesPage2);
  ddbMock.on(DescribeTableCommand, { TableName: 'orders' }).resolves(ordersTable);
  ddbMock.on(DescribeTableCommand, { TableName: 'events' }).resolves(eventsTable);
  ddbMock.on(DescribeTableCommand, { TableName: 'sessions' }).rejects(awsError('InternalServerError'));
  ddbMock.on(DescribeTableCommand, { TableName: 'gone' }).rejects(awsError('ResourceNotFoundException'));
}

describe('discoverDynamoDbTables', () => {
  it('paginates tables and scalable targets, maps capacity, and degrades failed DescribeTable calls', async () => {
    mockTables();
    aasMock
      .on(DescribeScalableTargetsCommand)
      .resolvesOnce(scalableTargetsPage1)
      .resolvesOnce(scalableTargetsPage2);
    taggingMock.on(GetResourcesCommand).resolves({
      ResourceTagMappingList: [
        {
          ResourceARN: 'arn:aws:dynamodb:us-east-1:111122223333:table/orders',
          Tags: [{ Key: 'app', Value: 'shop' }],
        },
      ],
    });
    const { logger, lines } = captureLogger();

    const result = await run(logger);

    expect(ddbMock.commandCalls(ListTablesCommand)[1]?.args[0].input.ExclusiveStartTableName).toBe('orders');
    const aasCalls = aasMock.commandCalls(DescribeScalableTargetsCommand);
    expect(aasCalls).toHaveLength(2);
    expect(aasCalls[0]?.args[0].input.ServiceNamespace).toBe('dynamodb');
    expect(aasCalls[1]?.args[0].input.NextToken).toBe('targets-2');
    expect(taggingMock.commandCalls(GetResourcesCommand)[0]?.args[0].input.ResourceTypeFilters).toEqual([
      'dynamodb:table',
    ]);

    expect(result.map((r) => r.resourceId)).toEqual(['orders', 'events', 'sessions']);
    const [orders, events, sessions] = result;
    expect(orders).toEqual({
      resourceType: 'DYNAMODB_TABLE',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceId: 'orders',
      arn: 'arn:aws:dynamodb:us-east-1:111122223333:table/orders',
      name: 'orders',
      state: 'ACTIVE',
      tags: { app: 'shop' },
      createdAt: '2024-01-01T00:00:00.000Z',
      attributes: {
        tableName: 'orders',
        billingMode: 'PROVISIONED',
        tableClass: 'STANDARD_INFREQUENT_ACCESS',
        provisionedReadCapacityUnits: 100,
        provisionedWriteCapacityUnits: 50,
        gsiCount: 2,
        gsiProvisionedReadCapacityUnits: 30,
        gsiProvisionedWriteCapacityUnits: 10,
        tableSizeBytes: 53687091200,
        itemCount: 1200000,
        autoScalingEnabled: true,
        deletionProtectionEnabled: true,
        replicaRegions: ['eu-west-1'],
      },
    });
    expect(events).toMatchObject({
      tags: {},
      attributes: {
        billingMode: 'PAY_PER_REQUEST',
        tableClass: 'STANDARD',
        provisionedReadCapacityUnits: null,
        provisionedWriteCapacityUnits: null,
        gsiCount: 0,
        autoScalingEnabled: false, // only a GSI target exists
        deletionProtectionEnabled: false,
        replicaRegions: [],
      },
    });
    expect(sessions).toMatchObject({
      state: 'unknown',
      arn: 'arn:aws:dynamodb:us-east-1:111122223333:table/sessions',
      createdAt: null,
      attributes: { billingMode: 'UNKNOWN', tableClass: 'UNKNOWN', provisionedReadCapacityUnits: null },
    });
    expect(warnings(lines).map((w) => w.tableName)).toEqual(['sessions']);
  });

  it('reports autoScalingEnabled null when DescribeScalableTargets fails', async () => {
    mockTables();
    aasMock.on(DescribeScalableTargetsCommand).rejects(awsError('AccessDeniedException'));
    taggingMock.on(GetResourcesCommand).resolves({});
    const result = await run();
    expect(result.map((r) => r.attributes.autoScalingEnabled)).toEqual([null, null, null]);
  });
});
