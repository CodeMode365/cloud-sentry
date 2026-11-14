import { describe, expect, it, vi } from 'vitest';
import {
  assertCursorScope,
  backoffDelay,
  createLogger,
  decodeCursor,
  encodeCursor,
  findingIdFor,
  isThrottlingError,
  mapSettledWithConcurrency,
  parseResourceKey,
  percentile,
  redact,
  resourceKeyFor,
  ulid,
  withRetry,
} from './index';

describe('ids', () => {
  it('ulid is 26 chars and time-sortable', () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_001);
    expect(a).toHaveLength(26);
    expect(a < b).toBe(true);
  });

  it('resource keys round-trip and reject malformed input', () => {
    const key = resourceKeyFor('123456789012', 'us-east-1', 'EC2_INSTANCE', 'i-abc');
    expect(parseResourceKey(key)).toEqual({
      accountId: '123456789012',
      region: 'us-east-1',
      resourceType: 'EC2_INSTANCE',
      resourceId: 'i-abc',
    });
    expect(parseResourceKey('not-a-key')).toBeNull();
    expect(parseResourceKey(Buffer.from('12|us-east-1|X|i').toString('base64url'))).toBeNull();
  });

  it('finding IDs are deterministic (deduplication by construction)', () => {
    expect(findingIdFor('1', 'r', 'rule', 'x')).toBe(findingIdFor('1', 'r', 'rule', 'x'));
    expect(findingIdFor('1', 'r', 'rule', 'x')).not.toBe(findingIdFor('1', 'r', 'rule', 'y'));
  });
});

describe('cursor', () => {
  it('round-trips and validates tenant scope', () => {
    const cursor = encodeCursor({ PK: 'TENANT#a#FINDINGS', SK: 'FINDING#1' });
    const key = decodeCursor(cursor);
    expect(() => assertCursorScope(key, ['PK'], 'TENANT#a')).not.toThrow();
    expect(() => assertCursorScope(key, ['PK'], 'TENANT#b')).toThrow('Invalid pagination cursor');
  });

  it('rejects garbage and nested values', () => {
    expect(() => decodeCursor('%%%')).toThrow();
    expect(() =>
      decodeCursor(Buffer.from(JSON.stringify({ PK: { S: 'x' } })).toString('base64url')),
    ).toThrow();
  });
});

describe('retry', () => {
  it('retries throttling with backoff and stops on non-retryable errors', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw Object.assign(new Error('slow down'), { name: 'ThrottlingException' });
        return 'ok';
      },
      { sleep, random: () => 0.5 },
    );
    expect(result).toBe('ok');
    expect(sleep).toHaveBeenCalledTimes(2);
    await expect(withRetry(() => Promise.reject(new Error('bad input')), { sleep })).rejects.toThrow(
      'bad input',
    );
  });

  it('backoff grows exponentially and is capped', () => {
    expect(backoffDelay(0, 100, 1000, () => 1)).toBe(100);
    expect(backoffDelay(3, 100, 1000, () => 1)).toBe(800);
    expect(backoffDelay(10, 100, 1000, () => 1)).toBe(1000);
  });

  it('classifies throttling errors', () => {
    expect(isThrottlingError({ name: 'RequestLimitExceeded' })).toBe(true);
    expect(isThrottlingError({ name: 'X', $metadata: { httpStatusCode: 429 } })).toBe(true);
    expect(isThrottlingError({ name: 'AccessDenied' })).toBe(false);
  });
});

describe('logger', () => {
  it('redacts secrets and credentials recursively', () => {
    const lines: string[] = [];
    const logger = createLogger({ service: 't', sink: (l) => lines.push(l) });
    logger.info('x', {
      externalId: 'abc',
      nested: { sessionToken: 's', ok: 1 },
      credentials: { accessKeyId: 'AKIA' },
    });
    const entry = JSON.parse(lines[0] as string);
    expect(entry.externalId).toBe('[REDACTED]');
    expect(entry.nested.sessionToken).toBe('[REDACTED]');
    expect(entry.nested.ok).toBe(1);
    expect(entry.credentials).toBe('[REDACTED]');
    expect(JSON.stringify(redact({ password: 'p' }))).not.toContain('"p"');
  });
});

describe('stats and concurrency', () => {
  it('computes interpolated percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([0, 10], 95)).toBeCloseTo(9.5);
    expect(percentile([], 50)).toBeNull();
  });

  it('reports each item outcome with bounded concurrency', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapSettledWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (n === 3) throw new Error('boom');
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(out.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(out[4]).toMatchObject({ status: 'fulfilled', value: 10 });
  });
});
