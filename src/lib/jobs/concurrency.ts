/**
 * How much of the pipeline runs at once.
 *
 * Two separate ceilings, and they multiply. `workerLanes()` is how many jobs the
 * worker runs side by side; `moduleConcurrency()` is how many modules one
 * `generate_course` job writes side by side. The most model calls in flight at
 * any moment is therefore lanes x modules, which is the number to think about
 * on a rate-limited tier, not either one alone.
 *
 * Both are read from the environment on every call rather than captured at
 * import: the worker is a long-lived process, and a value frozen at boot is one
 * an operator cannot change without a restart.
 */

function fromEnv(key: string, fallback: number, max: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  // Clamped rather than trusted. A typo in a deploy file should cost throughput,
  // not open two hundred concurrent calls against somebody's API key.
  return Math.min(Math.floor(n), max);
}

/**
 * Modules written concurrently inside one course build.
 *
 * Four by default. Module generation is independent by construction: a module
 * is written from its concept, the titles of its prerequisites and the retrieved
 * material, none of which is produced by another module in the same run. Four
 * takes a fourteen-module course from roughly twenty minutes to six, and stays
 * far enough below the burst limits of the hosted tiers that the 429 backoff in
 * the LLM layer stays a fallback rather than the normal path.
 *
 * Lite mode defaults to one. It exists for rate-limited free tiers (Groq's 12k
 * tokens a minute), where the constraint is tokens per minute and running four
 * writers at once buys nothing but 429s.
 */
export function moduleConcurrency(): number {
  const lite = process.env.FERRATA_LITE === "1";
  return fromEnv("FERRATA_MODULE_CONCURRENCY", lite ? 1 : 4, 8);
}

/**
 * Jobs the worker runs side by side.
 *
 * Two by default, and jobs for the same course never occupy two of them: the
 * lanes exist so a second author's course does not sit behind the first one's
 * twenty minutes, not to run one course's stages out of order. Serialization
 * within a course is what keeps every existing invariant in the pipeline true.
 */
export function workerLanes(): number {
  return fromEnv("FERRATA_WORKER_LANES", 2, 4);
}
