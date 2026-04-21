/**
 * Run an async task over each item in `items` with a bounded concurrency limit.
 * Uses Promise.allSettled semantics — failures don't block sibling tasks.
 *
 * Used by sync paths (S2, S3) to parallelize per-item work without flooding
 * the network or connection pool.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  const limit = Math.max(1, Math.floor(concurrency));
  let cursor = 0;

  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        const value = await task(items[idx], idx);
        results[idx] = { status: 'fulfilled', value };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  });

  await Promise.all(workers);
  return results;
}
