/**
 * A cap on how many password hashes run at once.
 *
 * One hash is ~100ms of CPU and 128 MiB, on the thread pool the rest of the app
 * shares. Per-account throttling cannot protect that: a caller who varies the
 * email on every request never trips it, and each of those requests now costs a
 * full hash on purpose (see authenticate). So the cost itself is bounded, for
 * everybody at once: a few run, a few wait, and the rest are told to come back.
 */
const MAX_RUNNING = 3;
const MAX_WAITING = 24;

let running = 0;
const waiting: Array<() => void> = [];

/** Runs `fn` when a slot is free; null when too many are already waiting. */
export async function withHashSlot<T>(fn: () => Promise<T>): Promise<T | null> {
  if (running >= MAX_RUNNING) {
    if (waiting.length >= MAX_WAITING) return null;
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running += 1;
  }
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next(); // the slot passes straight to the next in line
    else running -= 1;
  }
}
