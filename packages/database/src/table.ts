import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type NativeAttributeValue,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  ConflictError,
  PreconditionFailedError,
  assertCursorScope,
  chunk,
  decodeCursor,
  encodeCursor,
  isAwsErrorNamed,
  sleep,
} from '@cloudsentry/utilities';
import { KEY_ATTRIBUTES } from './keys';

export type Item = Record<string, NativeAttributeValue>;
export type Key = { PK: string; SK: string };

export interface TableOptions {
  tableName: string;
  region?: string;
  /** DynamoDB Local endpoint (local development and integration tests only). */
  endpoint?: string;
}

export function createDocumentClient(options: Omit<TableOptions, 'tableName'> = {}): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: options.region ?? process.env.AWS_REGION ?? 'us-east-1',
    maxAttempts: 6,
    retryMode: 'adaptive',
    ...(options.endpoint
      ? { endpoint: options.endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
      : {}),
  });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false },
  });
}

export interface QueryOptions {
  pk: string;
  index?: 'GSI1';
  skPrefix?: string;
  limit?: number;
  cursor?: string;
  /** Partition prefix every cursor key must carry (tenant isolation for forged cursors). */
  cursorScope?: string;
  ascending?: boolean;
  filter?: {
    expression: string;
    names?: Record<string, string>;
    values?: Record<string, NativeAttributeValue>;
  };
  consistentRead?: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Removes key/system attributes from an item before returning it as a domain record. */
export function toRecord<T>(item: Item): T {
  const copy: Item = { ...item };
  for (const attr of KEY_ATTRIBUTES) delete copy[attr];
  return copy as T;
}

export function isConditionFailure(error: unknown): boolean {
  return isAwsErrorNamed(error, 'ConditionalCheckFailedException');
}

export function isTransactionConditionFailure(error: unknown): boolean {
  if (!isAwsErrorNamed(error, 'TransactionCanceledException')) return false;
  const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
  return reasons.some((r) => r.Code === 'ConditionalCheckFailed');
}

/** Thin, typed wrapper around the DynamoDB document client for the CloudSentry single table. */
export class Table {
  constructor(
    readonly doc: DynamoDBDocumentClient,
    readonly tableName: string,
  ) {}

  static create(options: TableOptions): Table {
    return new Table(createDocumentClient(options), options.tableName);
  }

  async get<T>(key: Key, consistentRead = true): Promise<T | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: consistentRead }),
    );
    return out.Item ? toRecord<T>(out.Item) : null;
  }

  async getRaw(key: Key, consistentRead = true): Promise<Item | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: consistentRead }),
    );
    return out.Item ?? null;
  }

  async put(
    item: Item,
    condition?: {
      expression: string;
      names?: Record<string, string>;
      values?: Record<string, NativeAttributeValue>;
    },
  ): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ...(condition
          ? {
              ConditionExpression: condition.expression,
              ...(condition.names ? { ExpressionAttributeNames: condition.names } : {}),
              ...(condition.values ? { ExpressionAttributeValues: condition.values } : {}),
            }
          : {}),
      }),
    );
  }

  /** Put that fails with ConflictError if the item already exists. */
  async create(item: Item, conflictMessage: string): Promise<void> {
    try {
      await this.put(item, { expression: 'attribute_not_exists(PK)' });
    } catch (error) {
      if (isConditionFailure(error)) throw new ConflictError(conflictMessage);
      throw error;
    }
  }

  /**
   * Replaces an item guarded by optimistic locking. `expectedVersion` null means "must not exist yet".
   * Throws PreconditionFailedError when the stored version differs.
   */
  async putVersioned(item: Item & { version: number }, expectedVersion: number | null): Promise<void> {
    try {
      if (expectedVersion === null) {
        await this.put(item, { expression: 'attribute_not_exists(PK)' });
      } else {
        await this.put(item, {
          expression: '#v = :expected',
          names: { '#v': 'version' },
          values: { ':expected': expectedVersion },
        });
      }
    } catch (error) {
      if (isConditionFailure(error)) {
        throw new PreconditionFailedError('The record was modified concurrently; reload and retry');
      }
      throw error;
    }
  }

  /**
   * Applies a partial update (SET for defined values, REMOVE for null-valued keys listed in `remove`),
   * increments `version` and sets `updatedAt`. Returns the full updated record.
   */
  async patch<T>(
    key: Key,
    changes: Record<string, NativeAttributeValue>,
    options: {
      expectedVersion?: number;
      requireExists?: boolean;
      extraCondition?: {
        expression: string;
        names?: Record<string, string>;
        values?: Record<string, NativeAttributeValue>;
      };
      now?: string;
    } = {},
  ): Promise<T> {
    const names: Record<string, string> = { '#version': 'version', '#updatedAt': 'updatedAt' };
    const values: Record<string, NativeAttributeValue> = {
      ':one': 1,
      ':updatedAt': options.now ?? new Date().toISOString(),
    };
    const sets: string[] = ['#updatedAt = :updatedAt'];
    let i = 0;
    for (const [field, value] of Object.entries(changes)) {
      if (value === undefined) continue;
      if (field === 'version' || field === 'updatedAt') continue;
      const n = `#f${i}`;
      const v = `:v${i}`;
      names[n] = field;
      values[v] = value;
      sets.push(`${n} = ${v}`);
      i++;
    }
    const conditions: string[] = [];
    if (options.requireExists !== false) conditions.push('attribute_exists(PK)');
    if (options.expectedVersion !== undefined) {
      conditions.push('#version = :expectedVersion');
      values[':expectedVersion'] = options.expectedVersion;
    }
    if (options.extraCondition) {
      conditions.push(`(${options.extraCondition.expression})`);
      Object.assign(names, options.extraCondition.names ?? {});
      Object.assign(values, options.extraCondition.values ?? {});
    }
    try {
      const out = await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: key,
          UpdateExpression: `SET ${sets.join(', ')} ADD #version :one`,
          ...(conditions.length ? { ConditionExpression: conditions.join(' AND ') } : {}),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW',
        }),
      );
      return toRecord<T>(out.Attributes ?? {});
    } catch (error) {
      if (isConditionFailure(error)) {
        throw new PreconditionFailedError('The record does not exist or was modified concurrently');
      }
      throw error;
    }
  }

  async update(input: {
    key: Key;
    updateExpression: string;
    names?: Record<string, string>;
    values?: Record<string, NativeAttributeValue>;
    condition?: string;
  }): Promise<Item | null> {
    const out = await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: input.key,
        UpdateExpression: input.updateExpression,
        ...(input.names ? { ExpressionAttributeNames: input.names } : {}),
        ...(input.values ? { ExpressionAttributeValues: input.values } : {}),
        ...(input.condition ? { ConditionExpression: input.condition } : {}),
        ReturnValues: 'ALL_NEW',
      }),
    );
    return out.Attributes ?? null;
  }

  async delete(
    key: Key,
    condition?: {
      expression: string;
      names?: Record<string, string>;
      values?: Record<string, NativeAttributeValue>;
    },
  ): Promise<boolean> {
    try {
      await this.doc.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: key,
          ...(condition
            ? {
                ConditionExpression: condition.expression,
                ...(condition.names ? { ExpressionAttributeNames: condition.names } : {}),
                ...(condition.values ? { ExpressionAttributeValues: condition.values } : {}),
              }
            : {}),
        }),
      );
      return true;
    } catch (error) {
      if (condition && isConditionFailure(error)) return false;
      throw error;
    }
  }

  private async queryRaw(
    options: QueryOptions,
  ): Promise<{ items: Item[]; lastKey: Record<string, unknown> | undefined }> {
    const pkAttr = options.index === 'GSI1' ? 'GSI1PK' : 'PK';
    const skAttr = options.index === 'GSI1' ? 'GSI1SK' : 'SK';
    const startKey = decodeCursor(options.cursor);
    if (options.cursorScope) assertCursorScope(startKey, ['PK', 'GSI1PK'], options.cursorScope);
    // A cursor produced by a different query (other partition) must not be replayed against this one.
    if (startKey) assertCursorScope(startKey, [pkAttr], options.pk);
    const names: Record<string, string> = { '#pk': pkAttr, ...(options.filter?.names ?? {}) };
    const values: Record<string, NativeAttributeValue> = {
      ':pk': options.pk,
      ...(options.filter?.values ?? {}),
    };
    let keyCondition = '#pk = :pk';
    if (options.skPrefix) {
      names['#sk'] = skAttr;
      values[':skPrefix'] = options.skPrefix;
      keyCondition += ' AND begins_with(#sk, :skPrefix)';
    }
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        ...(options.index ? { IndexName: options.index } : {}),
        KeyConditionExpression: keyCondition,
        ...(options.filter ? { FilterExpression: options.filter.expression } : {}),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ...(options.limit ? { Limit: options.limit } : {}),
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        ScanIndexForward: options.ascending ?? true,
        ...(options.consistentRead && !options.index ? { ConsistentRead: true } : {}),
      }),
    );
    return { items: out.Items ?? [], lastKey: out.LastEvaluatedKey };
  }

  async queryPage<T>(options: QueryOptions): Promise<Page<T>> {
    const out = await this.queryRaw(options);
    return { items: out.items.map((i) => toRecord<T>(i)), nextCursor: encodeCursor(out.lastKey) };
  }

  /**
   * Returns up to `limit` items matching the filter. DynamoDB applies Limit before FilterExpression, so
   * this reads several underlying pages; when it over-reads, the cursor is re-anchored on the last returned
   * item so no matching item is skipped or duplicated.
   */
  async queryFilledPage<T>(options: QueryOptions & { limit: number }, maxReads = 8): Promise<Page<T>> {
    if (!options.filter) return this.queryPage<T>(options);
    const collected: Item[] = [];
    let cursor = options.cursor;
    let lastKey: Record<string, unknown> | undefined;
    for (let reads = 0; reads < maxReads; reads++) {
      const out = await this.queryRaw({ ...options, cursor, limit: Math.max(options.limit * 2, 100) });
      collected.push(...out.items);
      lastKey = out.lastKey;
      cursor = encodeCursor(lastKey) ?? undefined;
      if (!cursor || collected.length >= options.limit) break;
    }
    if (collected.length > options.limit) {
      const kept = collected.slice(0, options.limit);
      const anchor = kept[kept.length - 1] as Item;
      const anchorKey: Record<string, unknown> = { PK: anchor.PK, SK: anchor.SK };
      if (options.index === 'GSI1') {
        anchorKey.GSI1PK = anchor.GSI1PK;
        anchorKey.GSI1SK = anchor.GSI1SK;
      }
      return { items: kept.map((i) => toRecord<T>(i)), nextCursor: encodeCursor(anchorKey) };
    }
    return { items: collected.map((i) => toRecord<T>(i)), nextCursor: encodeCursor(lastKey) };
  }

  async queryAll<T>(options: Omit<QueryOptions, 'limit' | 'cursor'>, max = 10_000): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.queryPage<T>({ ...options, cursor, limit: 500 });
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && items.length < max);
    return items.slice(0, max);
  }

  async batchGet<T>(keyList: Key[]): Promise<T[]> {
    const results: T[] = [];
    for (const group of chunk(dedupeKeys(keyList), 100)) {
      let request: Record<string, { Keys: Key[]; ConsistentRead: boolean }> | undefined = {
        [this.tableName]: { Keys: group, ConsistentRead: true },
      };
      for (let attempt = 0; request && attempt < 8; attempt++) {
        const out = await this.doc.send(new BatchGetCommand({ RequestItems: request }));
        results.push(...(out.Responses?.[this.tableName] ?? []).map((i) => toRecord<T>(i)));
        const unprocessed = out.UnprocessedKeys?.[this.tableName]?.Keys as Key[] | undefined;
        request = unprocessed?.length
          ? { [this.tableName]: { Keys: unprocessed, ConsistentRead: true } }
          : undefined;
        if (request) await sleep(Math.min(2000, 50 * 2 ** attempt));
      }
      if (request) throw new Error('BatchGet did not complete: unprocessed keys remain after retries');
    }
    return results;
  }

  async batchWrite(puts: Item[], deletes: Key[] = []): Promise<void> {
    const requests = [
      ...puts.map((Item) => ({ PutRequest: { Item } })),
      ...deletes.map((Key) => ({ DeleteRequest: { Key } })),
    ];
    for (const group of chunk(requests, 25)) {
      let pending: typeof group | undefined = group;
      for (let attempt = 0; pending?.length && attempt < 8; attempt++) {
        const out = await this.doc.send(
          new BatchWriteCommand({ RequestItems: { [this.tableName]: pending } }),
        );
        pending = out.UnprocessedItems?.[this.tableName] as typeof group | undefined;
        if (pending?.length) await sleep(Math.min(2000, 50 * 2 ** attempt));
      }
      if (pending?.length)
        throw new Error('BatchWrite did not complete: unprocessed items remain after retries');
    }
  }

  async transact(items: NonNullable<TransactWriteCommandInput['TransactItems']>): Promise<void> {
    await this.doc.send(new TransactWriteCommand({ TransactItems: items }));
  }
}

function dedupeKeys(list: Key[]): Key[] {
  const seen = new Set<string>();
  return list.filter((k) => {
    const id = `${k.PK}\u0000${k.SK}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
