/** Helpers shared by discovery modules. */
import { awsErrorName, createLogger, type Logger } from '@cloudsentry/utilities';

export interface DiscoveryContext {
  accountId: string;
  region: string;
  /** Receives warnings about degraded sub-calls (tags, per-item details). Defaults to a scanner logger. */
  logger?: Logger;
  /** Reference time for age calculations (backup recovery points). Defaults to the current time. */
  now?: Date;
}

/** Concurrency limit for per-item sub-calls (DescribeTable, DescribeNodegroup, GetBackupPlan, ...). */
export const SUB_CALL_CONCURRENCY = 5;

export const defaultDiscoveryLogger: Logger = createLogger({ service: 'scanner-discovery' });

export function loggerFor(ctx: DiscoveryContext): Logger {
  return ctx.logger ?? defaultDiscoveryLogger;
}

/** True when AWS reports the item as gone (deleted between the list call and a per-item call). */
export function isNotFoundError(error: unknown): boolean {
  const name = awsErrorName(error) ?? '';
  return /NotFound/i.test(name);
}

/** Converts AWS `[{ Key, Value }]` tag lists into a plain record. Entries without a key are dropped. */
export function tagsToRecord(
  tags: readonly { Key?: string; Value?: string }[] | undefined | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of tags ?? []) {
    if (tag.Key) out[tag.Key] = tag.Value ?? '';
  }
  return out;
}

export function nameFromTags(tags: Record<string, string>): string | null {
  const name = tags.Name;
  return name !== undefined && name !== '' ? name : null;
}

export function toIso(value: Date | string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function orNull<T>(value: T | undefined | null): T | null {
  return value === undefined || value === null ? null : value;
}
