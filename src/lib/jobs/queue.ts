import { and, asc, eq, inArray, like, lte } from "drizzle-orm";
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
      // Also a column, so ownership can be asked as a question about a field
      // rather than about the shape of a blob.
      actorUserId: payload.actorUserId,
      status: "queued",
      maxAttempts: opts.maxAttempts ?? 3,
      runAfter: opts.runAfter ?? now(),
    })
    .run();
  return id;
}

/**
 * Queue a module rewrite unless one for the same concept is already queued or
 * running. Returns true if it enqueued, false if it deduplicated.
 *
 * The worker is a single lane, so the same concept reaching here twice, from a
 * double click or from the manual button and an approved proposal at once,
 * would run the whole quality loop twice: billed twice, and the second run
 * deletes the questions the first just wrote. One guard, used by both callers.
 */
export function enqueueRegenerateModuleOnce(
  courseId: string,
  conceptId: string,
  actorUserId: string | null,
  /** Rewrite against the questions readers get wrong, not from nothing. */
  useFailures = false,
): boolean {
  const inFlight = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, "regenerate_module"),
        inArray(jobs.status, ["queued", "running"]),
        like(jobs.payloadJson, `%"${conceptId}"%`),
      ),
    )
    .get();
  if (inFlight) return false;
  enqueue("regenerate_module", {
    courseId,
    conceptId,
    actorUserId,
    useFailures,
  });
  return true;
}

/** The course a job is about, or null for work that belongs to no course. */
export function jobCourseId(payloadJson: string): string | null {
  try {
    const p = JSON.parse(payloadJson) as { courseId?: unknown };
    return typeof p.courseId === "string" ? p.courseId : null;
  } catch {
    return null;
  }
}

/**
 * Atomically claim the next runnable job, marking it running.
 *
 * `busyCourseIds` are courses that already have a job running. The worker runs
 * several jobs side by side, but never two on the same course: the stages of a
 * build are ordered (intake decides the concepts the graph orders and the
 * modules are written from), and a course whose `generate_course` overlapped
 * its own retry would write every module twice, bill for both and have the
 * second delete the questions the first wrote. Skipping rather than blocking is
 * the point: the next course's work starts now instead of waiting behind a
 * twenty-minute build.
 */
export function claimNext(
  busyCourseIds: ReadonlySet<string> = new Set(),
): Job | null {
  return db.transaction((tx) => {
    const runnable = tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "queued"), lte(jobs.runAfter, now())))
      .orderBy(asc(jobs.runAfter))
      .all();
    const job = runnable.find((j) => {
      const courseId = jobCourseId(j.payloadJson);
      return courseId === null || !busyCourseIds.has(courseId);
    });
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
    // Only while it is still ours. A job abandoned for running past its
    // deadline has been given up on and possibly queued again; letting a
    // handler that finally returned mark it done would resurrect a row
    // somebody else is now working, and report success for work whose result
    // was already written off.
    .where(and(eq(jobs.id, id), eq(jobs.status, "running")))
    .run();
}

/**
 * How long a job of each type may run before the worker stops waiting for it.
 *
 * Generous, and measured rather than guessed: a full course build takes about
 * twenty minutes on a hosted model, a module rewrite about five. The point is
 * not to police slowness, it is that a handler which will never return should
 * not hold a lane and a course forever.
 *
 * The failure this exists for is not the common one. A process that dies mid
 * job is already recovered at the next startup, because a single worker means
 * anything left `running` belongs to a process that is gone. What was left
 * uncovered is a handler that hangs while the worker is perfectly alive: no
 * timeout, no recovery, no sign on any page, and the only cure a restart the
 * operator has no way of knowing they need.
 */
const DEADLINE_MS: Record<string, number> = {
  generate_course: 90 * 60_000,
  regenerate_module: 30 * 60_000,
  propose_updates: 20 * 60_000,
  check_sources: 20 * 60_000,
};
const DEFAULT_DEADLINE_MS = 15 * 60_000;

export function jobDeadlineMs(type: string): number {
  return DEADLINE_MS[type] ?? DEFAULT_DEADLINE_MS;
}

/**
 * Give up on jobs that have been running past their deadline.
 *
 * Abandoned rather than stopped, and the difference is worth naming: nothing
 * here can cancel a promise that is already in flight. What this does is stop
 * counting on it, free the lane and the course, and say so. If the handler ever
 * does return, markDone above refuses it.
 *
 * Retried if attempts remain, because the usual cause is a call that hung
 * rather than work that is impossible, and the second attempt normally lands.
 */
export function abandonOverdue(at: number = now()): Job[] {
  const abandoned: Job[] = [];
  for (const job of db.select().from(jobs).where(eq(jobs.status, "running")).all()) {
    const overdue = at - job.updatedAt > jobDeadlineMs(job.type);
    if (!overdue) continue;
    const minutes = Math.round(jobDeadlineMs(job.type) / 60_000);
    const error = `abandoned: still running after ${minutes} minutes, so the worker stopped waiting for it`;
    if (job.attempts >= job.maxAttempts) {
      db.update(jobs)
        .set({ status: "failed", error, updatedAt: at })
        .where(eq(jobs.id, job.id))
        .run();
    } else {
      db.update(jobs)
        .set({ status: "queued", error, runAfter: at, updatedAt: at })
        .where(eq(jobs.id, job.id))
        .run();
    }
    abandoned.push(job);
  }
  return abandoned;
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
