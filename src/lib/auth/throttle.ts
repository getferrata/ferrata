/**
 * Failed-attempt throttling for the endpoints worth guessing at: signing in,
 * and spending an invite token.
 *
 * Passwords are scrypt hashed with a per-user salt, so a stolen database is not
 * the worry. Online guessing is: a login endpoint with no limit will answer as
 * fast as someone can ask, forever. Counting failures and refusing for a while
 * turns an overnight dictionary run into nothing.
 *
 * State lives in memory. One install is one process, and losing the counters on
 * restart costs an attacker a restart they cannot trigger.
 */

interface Bucket {
  failures: number;
  /** When the current window began. */
  since: number;
  /** Set once the bucket trips; refuse until then. */
  blockedUntil: number;
}

const buckets = new Map<string, Bucket>();

/** Failures tolerated in a window before the key is refused. */
const LIMIT = 8;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

/** Keep the map from growing without bound on a long-lived process. */
const MAX_KEYS = 10_000;

function bucketFor(key: string, at: number): Bucket {
  const found = buckets.get(key);
  if (found && at - found.since < WINDOW_MS) return found;
  const fresh: Bucket = { failures: 0, since: at, blockedUntil: 0 };
  if (buckets.size >= MAX_KEYS) {
    // Drop the oldest window rather than refusing to track anything new:
    // forgetting an old counter is safer than becoming unlimited.
    for (const [k, b] of buckets) {
      if (at - b.since >= WINDOW_MS) buckets.delete(k);
    }
    if (buckets.size >= MAX_KEYS) buckets.clear();
  }
  buckets.set(key, fresh);
  return fresh;
}

export interface ThrottleVerdict {
  allowed: boolean;
  /** Seconds the caller should wait, for the Retry-After header. */
  retryAfterSec: number;
}

/** Check before doing the work. Does not itself count a failure. */
export function checkThrottle(key: string, at: number = Date.now()): ThrottleVerdict {
  const b = buckets.get(key);
  if (!b || b.blockedUntil <= at) return { allowed: true, retryAfterSec: 0 };
  return {
    allowed: false,
    retryAfterSec: Math.max(1, Math.ceil((b.blockedUntil - at) / 1000)),
  };
}

/** Record a failed attempt, tripping the block once the limit is reached. */
export function recordFailure(key: string, at: number = Date.now()): void {
  const b = bucketFor(key, at);
  b.failures += 1;
  if (b.failures >= LIMIT) b.blockedUntil = at + BLOCK_MS;
}

/** A success clears the key, so a legitimate user is never punished later. */
export function clearFailures(key: string): void {
  buckets.delete(key);
}

/**
 * Best-effort client address. Behind a reverse proxy the socket address is the
 * proxy, so the forwarded header is used when present. It is spoofable by
 * anyone talking to the app directly, which is why the email is throttled too:
 * an attacker can rotate one of the two keys, not both.
 */
export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** Test seam: drop all counters. */
export function resetThrottle(): void {
  buckets.clear();
}
