import { isTransientError } from './errors';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter: delay = random(0, min(maxDelay, base * 2^attempt)). */
export function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random = Math.random,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

/**
 * Retries `fn` on retryable errors. AWS SDK clients already retry throttling internally (adaptive mode);
 * this wrapper is for coarser operations (a whole paginated listing, a pricing lookup).
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const isRetryable = options.isRetryable ?? isTransientError;
  const doSleep = options.sleep ?? sleep;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1 || !isRetryable(error)) throw error;
      const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs, options.random);
      options.onRetry?.(error, attempt + 1, delay);
      await doSleep(delay);
    }
  }
  throw lastError;
}
