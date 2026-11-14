export type SettledResult<T, I> =
  { status: 'fulfilled'; item: I; value: T } | { status: 'rejected'; item: I; reason: unknown };

/** Maps items with bounded concurrency, never rejecting: each item's outcome is reported individually. */
export async function mapSettledWithConcurrency<I, T>(
  items: readonly I[],
  limit: number,
  fn: (item: I, index: number) => Promise<T>,
): Promise<SettledResult<T, I>[]> {
  const results: SettledResult<T, I>[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index] as I;
      try {
        results[index] = { status: 'fulfilled', item, value: await fn(item, index) };
      } catch (reason) {
        results[index] = { status: 'rejected', item, reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/** Maps items with bounded concurrency; rejects on the first failure. */
export async function mapWithConcurrency<I, T>(
  items: readonly I[],
  limit: number,
  fn: (item: I, index: number) => Promise<T>,
): Promise<T[]> {
  const settled = await mapSettledWithConcurrency(items, limit, fn);
  return settled.map((r) => {
    if (r.status === 'rejected') throw r.reason;
    return r.value;
  });
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
