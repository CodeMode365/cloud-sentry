import {
  paginateListFunctions,
  paginateListProvisionedConcurrencyConfigs,
  type FunctionConfiguration,
  type LambdaClient,
  type ProvisionedConcurrencyConfigListItem,
} from '@aws-sdk/client-lambda';
import type { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import type { DiscoveredResourceOf, LambdaFunctionAttributes } from '@cloudsentry/shared-types';
import { awsErrorName, errorMessage, mapSettledWithConcurrency } from '@cloudsentry/utilities';
import { loggerFor, orNull, SUB_CALL_CONCURRENCY, toIso, type DiscoveryContext } from './common';
import { fetchTagsByArn } from './tagging';

type ProvisionedConcurrency = LambdaFunctionAttributes['provisionedConcurrency'];

/** Qualifier (alias or version) of a qualified function ARN `arn:aws:lambda:<r>:<a>:function:<name>:<q>`. */
export function qualifierFromArn(functionArn: string | undefined): string | null {
  const parts = (functionArn ?? '').split(':');
  return parts.length >= 8 && parts[7] ? parts[7] : null;
}

export function mapProvisionedConcurrency(
  items: readonly ProvisionedConcurrencyConfigListItem[],
): ProvisionedConcurrency {
  const out: ProvisionedConcurrency = [];
  for (const item of items) {
    const qualifier = qualifierFromArn(item.FunctionArn);
    if (!qualifier) continue;
    out.push({
      qualifier,
      allocated: item.AllocatedProvisionedConcurrentExecutions ?? 0,
      requested: item.RequestedProvisionedConcurrentExecutions ?? 0,
      status: orNull(item.Status),
    });
  }
  return out.sort((a, b) => (a.qualifier < b.qualifier ? -1 : a.qualifier > b.qualifier ? 1 : 0));
}

/**
 * `$LATEST` function configuration (ListFunctions without FunctionVersion=ALL). Lambda reports no creation
 * time, so `createdAt` is null; `lastModified` is the last code/configuration change.
 */
export function mapLambdaFunction(
  fn: FunctionConfiguration,
  ctx: DiscoveryContext,
  tags: Record<string, string>,
  provisionedConcurrency: ProvisionedConcurrency,
): DiscoveredResourceOf<'LAMBDA_FUNCTION'> | null {
  const functionName = fn.FunctionName;
  if (!functionName) return null;
  const arn = fn.FunctionArn ?? `arn:aws:lambda:${ctx.region}:${ctx.accountId}:function:${functionName}`;
  return {
    resourceType: 'LAMBDA_FUNCTION',
    accountId: ctx.accountId,
    region: ctx.region,
    resourceId: arn,
    arn,
    name: functionName,
    state: fn.State ?? 'Active',
    tags,
    createdAt: null,
    attributes: {
      functionName,
      runtime: orNull(fn.Runtime),
      architecture: fn.Architectures?.[0] ?? 'x86_64',
      memoryMb: fn.MemorySize ?? 128,
      timeoutSeconds: fn.Timeout ?? 3,
      packageType: fn.PackageType ?? 'Zip',
      ephemeralStorageMb: orNull(fn.EphemeralStorage?.Size),
      lastModified: toIso(fn.LastModified),
      provisionedConcurrency,
    },
  };
}

async function listProvisionedConcurrency(
  client: LambdaClient,
  functionName: string,
): Promise<ProvisionedConcurrency> {
  const items: ProvisionedConcurrencyConfigListItem[] = [];
  for await (const page of paginateListProvisionedConcurrencyConfigs(
    { client, pageSize: 50 },
    { FunctionName: functionName },
  )) {
    items.push(...(page.ProvisionedConcurrencyConfigs ?? []));
  }
  return mapProvisionedConcurrency(items);
}

/**
 * Lambda functions with their provisioned concurrency configurations. Tags come from the Tagging API;
 * a failed ListProvisionedConcurrencyConfigs call leaves that function with `provisionedConcurrency: []`.
 */
export async function discoverLambdaFunctions(
  client: LambdaClient,
  tagging: ResourceGroupsTaggingAPIClient,
  ctx: DiscoveryContext,
): Promise<DiscoveredResourceOf<'LAMBDA_FUNCTION'>[]> {
  const logger = loggerFor(ctx);
  const tagsPromise = fetchTagsByArn(tagging, ['lambda:function'], logger);

  const functions: FunctionConfiguration[] = [];
  for await (const page of paginateListFunctions({ client, pageSize: 50 }, {})) {
    for (const fn of page.Functions ?? []) {
      if (fn.FunctionName) functions.push(fn);
    }
  }

  const pc = await mapSettledWithConcurrency(functions, SUB_CALL_CONCURRENCY, (fn) =>
    listProvisionedConcurrency(client, fn.FunctionName as string),
  );
  const tagsByArn = await tagsPromise;

  const out: DiscoveredResourceOf<'LAMBDA_FUNCTION'>[] = [];
  for (const result of pc) {
    const fn = result.item;
    let configs: ProvisionedConcurrency = [];
    if (result.status === 'fulfilled') configs = result.value;
    else {
      logger.warn('ListProvisionedConcurrencyConfigs failed; provisioned concurrency unknown', {
        region: ctx.region,
        functionName: fn.FunctionName,
        awsError: awsErrorName(result.reason),
        message: errorMessage(result.reason),
      });
    }
    const mapped = mapLambdaFunction(fn, ctx, tagsByArn.get(fn.FunctionArn ?? '') ?? {}, configs);
    if (mapped) out.push(mapped);
  }
  return out;
}
