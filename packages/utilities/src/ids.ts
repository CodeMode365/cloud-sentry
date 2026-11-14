import { createHash, randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: 48-bit millisecond timestamp + 80 bits of randomness, Crockford base32. Lexicographically time-sortable. */
export function ulid(timeMs: number = Date.now()): string {
  let time = '';
  let t = timeMs;
  for (let i = 0; i < 10; i++) {
    time = (CROCKFORD[t % 32] as string) + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(10);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand = (CROCKFORD[Number(bits & 31n)] as string) + rand;
    bits >>= 5n;
  }
  return time + rand;
}

export const newId = {
  tenant: () => `ten_${ulid()}`,
  scan: () => `scan_${ulid()}`,
  report: () => `rpt_${ulid()}`,
  notification: () => `ntf_${ulid()}`,
  request: () => `req_${ulid()}`,
};

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Deterministic identifier derived from ordered parts. Used for finding/recommendation deduplication. */
export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${sha256Hex(parts.join('\u001f')).slice(0, 32)}`;
}

export function findingIdFor(accountId: string, region: string, ruleId: string, resourceId: string): string {
  return stableId('fnd', accountId, region, ruleId, resourceId);
}

export function recommendationIdFor(findingId: string): string {
  return stableId('rec', findingId);
}

/** Cryptographically random external ID for cross-account AssumeRole (AWS allows 2-1224 chars, [\w+=,.@:/-]). */
export function generateExternalId(): string {
  return `cs-${randomBytes(24).toString('base64url')}`;
}

export function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

/** CloudSentry resource key: reversible, URL-safe encoding of the resource's natural identity. */
export function resourceKeyFor(
  accountId: string,
  region: string,
  resourceType: string,
  resourceId: string,
): string {
  return base64UrlEncode([accountId, region, resourceType, resourceId].join('|'));
}

export function parseResourceKey(
  key: string,
): { accountId: string; region: string; resourceType: string; resourceId: string } | null {
  try {
    const decoded = base64UrlDecode(key);
    const [accountId, region, resourceType, ...rest] = decoded.split('|');
    const resourceId = rest.join('|');
    if (!accountId || !region || !resourceType || !resourceId) return null;
    if (!/^\d{12}$/.test(accountId)) return null;
    return { accountId, region, resourceType, resourceId };
  } catch {
    return null;
  }
}
