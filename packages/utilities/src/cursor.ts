import { ValidationError } from './errors';

/**
 * Pagination cursors wrap DynamoDB LastEvaluatedKey values. Cursors are opaque to clients but are NOT
 * trusted: callers must validate that every key in a decoded cursor belongs to the caller's tenant
 * (see `assertCursorScope`) so a forged cursor can never read another tenant's partition.
 */
export function encodeCursor(key: Record<string, unknown> | undefined | null): string | null {
  if (!key) return null;
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined | null): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    for (const v of Object.values(parsed)) {
      if (typeof v !== 'string' && typeof v !== 'number') throw new Error('invalid key value');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ValidationError('Invalid pagination cursor');
  }
}

/** Throws unless every partition-key attribute in the cursor starts with the expected prefix. */
export function assertCursorScope(
  key: Record<string, unknown> | undefined,
  partitionAttributes: readonly string[],
  expectedPrefix: string,
): void {
  if (!key) return;
  for (const attr of partitionAttributes) {
    const value = key[attr];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.startsWith(expectedPrefix)) {
      throw new ValidationError('Invalid pagination cursor');
    }
  }
}
