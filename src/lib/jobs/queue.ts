import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { jobs, type Job } from "@/db/schema";
import { newId, now } from "@/lib/util/id";

/**
 * SQLite-backed job queue. No Redis, no broker: a `jobs` row is the
 * unit of work, claimed by the in-process worker via a short transaction.
 */

/**
 * Queue work. `actorUserId` is required rather than optional: the worker runs
 * far from the request that started the job, so this payload field is the only
 * way spend can be attributed back to a person. Making it optional would make
 * forgetting it the easy path.
 */
export function enqueue(
  type: string,
  payload: { actorUserId: string | null } & Record<string, unknown>,
  opts: { maxAttempts?: number; runAfter?: number } = {},
): string {
  const id = newId("job");
  db.insert(jobs)
    .values({
      id,
      type,
      payloadJson: JSON.stringify(payload),
      status: "queued",
      maxAttempts: opts.maxAttempts ?? 3,
      runAfter: opts.runAfter ?? now(),
    })
    .run();
  return id;
}

/** Atomically claim the next runnable job, marking it running. */
export function claimNext(): Job | null {
  return db.transaction((tx) => {
    const job = tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "queued"), lte(jobs.runAfter, now())))
      .orderBy(asc(jobs.runAfter))
      .limit(1)
      .get();
    if (!job) return null;
    tx.update(jobs)
      .set({ status: "running", attempts: job.attempts + 1, updatedAt: now() })
      .where(eq(jobs.id, job.id))
      .run();
    return { ...job, status: "running", attempts: job.attempts + 1 };
  });
}

export function markDone(id: string, result: unknown): void {
  db.update(jobs)
    .set({
      status: "done",
      resultJson: JSON.stringify(result ?? null),
      updatedAt: now(),
    })
    .where(eq(jobs.id, id))
    .run();
}

/**
 * Record a failure. If attempts remain, requeue with exponential backoff;
 * otherwise mark failed permanently.
 */
export function markFailed(job: Job, error: string): void {
  const exhausted = job.attempts >= job.maxAttempts;
  if (exhausted) {
    db.update(jobs)
      .set({ status: "failed", error, updatedAt: now() })
      .where(eq(jobs.id, job.id))
      .run();
    return;
  }
  const backoffMs = 2000 * 2 ** (job.attempts - 1); // 2s, 4s, 8s, …
  db.update(jobs)
    .set({
      status: "queued",
      error,
      runAfter: now() + backoffMs,
      updatedAt: now(),
    })
    .where(eq(jobs.id, job.id))
    .run();
}

/**
 * Recover jobs a previous process left mid-flight. Only one worker runs per
 * install, so anything still marked `running` at startup belongs to a process
 * that is gone: a container restart, a host reboot, an out-of-memory kill.
 * Without this the row is never claimed again (claimNext only takes queued
 * work) and the course sits in "generating" forever.
 *
 * Handlers must be safe to run twice for this to be free of side effects.
 * Returns the requeued count and the jobs that had no attempts left, so the
 * caller can reflect those on whatever they were building.
 */
export function recoverOrphaned(): { requeued: number; failed: Job[] } {
  const orphans = db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "running"))
    .all();
  let requeued = 0;
  const failed: Job[] = [];
  for (const job of orphans) {
    // The attempt was already counted when the job was claimed, so an orphan
    // that has used its last attempt must not silently get another one.
    if (job.attempts >= job.maxAttempts) {
      db.update(jobs)
        .set({
          status: "failed",
          error: "interrupted: the server stopped while this job was running",
          updatedAt: now(),
        })
        .where(eq(jobs.id, job.id))
        .run();
      failed.push(job);
      continue;
    }
    db.update(jobs)
      .set({ status: "queued", runAfter: now(), updatedAt: now() })
      .where(eq(jobs.id, job.id))
      .run();
    requeued++;
  }
  return { requeued, failed };
}
