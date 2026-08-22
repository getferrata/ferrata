/**
 * Run an async function over a list with a ceiling on how many run at once.
 *
 * Results come back in input order regardless of the order they finished in,
 * so a caller can still line them up against what it passed.
 *
 * A rejection does not abandon the lanes that are still running. The work here
 * is billed model calls: dropping the promise for one that is already in flight
 * would pay for an answer nobody is waiting for, and would leave the writes it
 * makes on completion racing against whatever the caller does next. The first
 * error is kept and thrown once every lane has drained.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const lanes = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const failures: unknown[] = [];
  let next = 0;

  const drain = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i] as T, i);
      } catch (err) {
        failures.push(err);
      }
    }
  };

  await Promise.all(Array.from({ length: lanes }, drain));
  if (failures.length > 0) throw failures[0];
  return results;
}
