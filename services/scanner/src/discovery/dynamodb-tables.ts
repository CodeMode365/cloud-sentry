import {
  paginateDescribeScalableTargets,
  type ApplicationAutoScalingClient,
} from '@aws-sdk/client-application-auto-scaling';
import {
  DescribeTableCommand,
  paginateListTables,
  type DynamoDBClient,
  type TableDescription,
} from '@aws-sdk/client-dynamodb';
import type { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import type { DiscoveredResourceOf } from '@cloudsentry/shared-types';
import { awsErrorName, errorMessage, mapSettledWithConcurrency, sum, type Logger } from '@cloudsentry/utilities';
import {
  isNotFoundError,
  loggerFor,
  orNull,
  SUB_CALL_CONCURRENCY,
  toIso,
  type DiscoveryContext,
} from './common';
import { fetchTagsByArn } from './tagging';

/** Billing mode / table class / state reported when DescribeTable failed; no metrics or rules apply. */
export const DYNAMODB_UNKNOWN = 'UNKNOWN';

/**
 * Table-level Application Auto Scaling targets (`table/<name>`; GSI targets `table/<name>/index/<i>` are
 * ignored). Returns null when the call failed, so `autoScalingEnabled` becomes unknown rather than false.
 */
export async function fetchAutoScaledTables(
  client: ApplicationAutoScalingClient,
  logger: Logger,
): Promise<Set<string> | null> {
  try {
    const tables = new Set<string>();
    for await (const page of paginateDescribeScalableTargets(
      { client, pageSize: 50 },
      { ServiceNamespace: 'dynamodb' },
    )) {
      for (const target of page.ScalableTargets ?? []) {
        const parts = (target.ResourceId ?? '').split('/');
        if (parts.length === 2 && parts[0] === 'table' && parts[1]) tables.add(parts[1]);
      }
    }
    return tables;
  } catch (error) {
    logger.warn('DescribeScalableTargets failed; DynamoDB auto scaling unknown', {
      awsError: awsErrorName(error),
      message: errorMessage(error),
    });
    return null;
  }
}

export function mapDynamoDbTable(
  tableName: string,
  table: TableDescription | null,
  ctx: DiscoveryContext,
  tagsByArn: ReadonlyMap<string, Record<string, string>>,
  autoScaledTables: ReadonlySet<string> | null,
): DiscoveredResourceOf<'DYNAMODB_TABLE'> {
  const arn = table?.TableArn ?? `arn:aws:dynamodb:${ctx.region}:${ctx.accountId}:table/${tableName}`;
  // Tables created before on-demand existed have no BillingModeSummary and are provisioned.
  const billingMode = table ? (table.BillingModeSummary?.BillingMode ?? 'PROVISIONED') : DYNAMODB_UNKNOWN;
  const provisioned = billingMode === 'PROVISIONED';
  const gsis = table?.GlobalSecondaryIndexes ?? [];
  return {
    resourceType: 'DYNAMODB_TABLE',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: tableName,
    arn,
    name: tableName,
    state: table ? (table.TableStatus ?? 'unknown') : 'unknown',
    tags: tagsByArn.get(arn) ?? {},
    createdAt: toIso(table?.CreationDateTime),
    attributes: {
      tableName,
      billingMode,
      tableClass: table ? (table.TableClassSummary?.TableClass ?? 'STANDARD') : DYNAMODB_UNKNOWN,
      provisionedReadCapacityUnits: provisioned ? orNull(table?.ProvisionedThroughput?.ReadCapacityUnits) : null,
      provisionedWriteCapacityUnits: provisioned ? orNull(table?.ProvisionedThroughput?.WriteCapacityUnits) : null,
      gsiCount: gsis.length,
      gsiProvisionedReadCapacityUnits: sum(gsis.map((g) => g.ProvisionedThroughput?.ReadCapacityUnits ?? 0)),
      gsiProvisionedWriteCapacityUnits: sum(gsis.map((g) => g.ProvisionedThroughput?.WriteCapacityUnits ?? 0)),
      tableSizeBytes: table?.TableSizeBytes ?? 0,
      itemCount: table?.ItemCount ?? 0,
      autoScalingEnabled: autoScaledTables ? autoScaledTables.has(tableName) : null,
      deletionProtectionEnabled: table?.DeletionProtectionEnabled ?? false,
      replicaRegions: (table?.Replicas ?? [])
        .map((r) => r.RegionName)
        .filter((r): r is string => !!r && r !== ctx.region),
    },
  };
}

/**
 * DynamoDB tables with capacity, size and auto scaling state. DescribeTable runs per table with bounded
 * concurrency: a table deleted mid-scan is skipped; any other failure keeps the table with state
 * `unknown` and billing mode `UNKNOWN` (no metrics or rules) instead of failing the region.
 */
export async function discoverDynamoDbTables(
  client: DynamoDBClient,
  autoScaling: ApplicationAutoScalingClient,
  tagging: ResourceGroupsTaggingAPIClient,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'DYNAMODB_TABLE'>[]> {
  const logger = loggerFor(ctx);
  const tagsPromise = fetchTagsByArn(tagging, ['dynamodb:table'], logger);
  const autoScalingPromise = fetchAutoScaledTables(autoScaling, logger);

  const tableNames: string[] = [];
  for await (const page of paginateListTables({ client, pageSize: 100 }, {})) {
    tableNames.push(...(page.TableNames ?? []));
  }

  const described = await mapSettledWithConcurrency(tableNames, SUB_CALL_CONCURRENCY, async (TableName) => {
    const out = await client.send(new DescribeTableCommand({ TableName }));
    return out.Table ?? null;
  });
  const [tagsByArn, autoScaledTables] = await Promise.all([tagsPromise, autoScalingPromise]);

  const out: DiscoveredResourceOf<'DYNAMODB_TABLE'>[] = [];
  for (const result of described) {
    let table: TableDescription | null = null;
    if (result.status === 'fulfilled') table = result.value;
    else if (isNotFoundError(result.reason)) continue;
    else {
      logger.warn('DescribeTable failed; table reported with state unknown', {
        region: ctx.region,
        tableName: result.item,
        awsError: awsErrorName(result.reason),
        message: errorMessage(result.reason),
      });
    }
    out.push(mapDynamoDbTable(result.item, table, ctx, tagsByArn, autoScaledTables));
  }
  return out;
}
