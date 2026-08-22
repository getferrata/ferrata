import { and, eq, inArray } from "drizzle-orm";
import { checkpoint, db } from "@/db";
import { courses, jobs, type Job } from "@/db/schema";
import {
  claimNext,
  enqueue,
  jobCourseId,
  markDone,
  markFailed,
  abandonOverdue,
  recoverOrphaned,
} from "./queue";
import { HANDLERS } from "./handlers";
import { getLogger } from "@/lib/log";
import { withActor } from "@/lib/llm/actor";
import { backupIsDue, runBackup } from "@/lib/backup";
import { sourceCheckIsDue } from "@/lib/sources/watch";
import { workerLanes } from "./concurrency";

const log = getLogger("worker");

/**
 * In-process worker. Polls the jobs table on an interval and runs a few jobs
 * side by side, never two on the same course (see claimNext). Booted once from
 * src/instrumentation.ts and kept on globalThis so HMR does not spawn copies.
 *
 * Concurrency is safe here because better-sqlite3 is synchronous: a statement,
 * and a transaction whose callback does not await, runs to completion before
 * any other lane gets the thread back. The rule that keeps it that way is that
 * nothing awaits inside a db.transaction callback.
 */

const POLL_MS = 1000;

/** The jobs that build a course, and so own its status. */
const PIPELINE_JOBS = new Set([
  "interview_questions",
  "intake",
  "build_graph",
  "generate_course",
]);

const globalForWorker = globalThis as unknown as {
  __ferrataWorker?: { timer: NodeJS.Timeout };
};

/**
 * Which jobs are running right now, mapped to the course each belongs to. The
 * courses are what claimNext needs to keep one course in one lane; the ids are
 * what tells the tick whether the install is idle.
 */
interface WorkerState {
  inFlight: Map<string, string | null>;
  backupRunning: boolean;
}

async function tick(state: WorkerState): Promise<void> {
  // A backup takes the install to itself. It only starts when nothing is
  // running, and nothing new starts under it.
  if (state.backupRunning) return;

  // Before claiming anything, let go of whatever has been running too long.
  // The lane it was holding is freed here rather than by the promise, which
  // may never settle; that is the whole point of giving up on it.
  for (const job of abandonOverdue()) {
    state.inFlight.delete(job.id);
    log.error(
      `job ${job.id} (${job.type}) abandoned after ${Math.round((Date.now() - job.updatedAt) / 60_000)} minutes`,
      { attempt: job.attempts, willRetry: job.attempts < job.maxAttempts },
    );
  }

  const lanes = workerLanes();
  let claimed = 0;
  while (state.inFlight.size < lanes) {
    const busy = new Set(
      [...state.inFlight.values()].filter((c): c is string => c !== null),
    );
    const job = claimNext(busy);
    if (!job) break;
    claimed++;
    // Recorded before the first await, so the next turn of this loop already
    // counts it against the lane budget and against its own course.
    state.inFlight.set(job.id, jobCourseId(job.payloadJson));
    void run(job)
      // run() handles a failing job itself; this catches a failure in that
      // handling. Either way the lane has to come back, or the install quietly
      // loses one and the course it held never gets claimed again.
      .catch((err: unknown) => {
        log.error(
          `job ${job.id} (${job.type}) could not be recorded: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        state.inFlight.delete(job.id);
      });
  }

  if (claimed === 0 && state.inFlight.size === 0) {
    // Idle: fold the write-ahead log back into the database file, so the copy
    // somebody takes with cp is the whole database rather than the database as
    // of the last checkpoint. See the note on checkpoint().
    checkpoint();
    queueSourceCheckIfDue();
    await backupIfDue(state);
  }
}

/**
 * Queue a re-read of the attached sources, if any are old enough to be worth
 * one and nothing is already going to do it.
 *
 * Queued rather than run here. Re-reading is network work that can take minutes
 * across a course's worth of links, and the idle branch is the wrong place for
 * anything slow: it is what the checkpoint and the backup share, and holding it
 * would stall both. As a job it also gets retries and a row in the ledger of
 * work, which is what every other slow thing in this install gets.
 */
function queueSourceCheckIfDue(): void {
  if (!sourceCheckIsDue()) return;
  const inFlight = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(eq(jobs.type, "check_sources"), inArray(jobs.status, ["queued", "running"])),
    )
    .get();
  if (inFlight) return;
  // No actor: the schedule is not a person. What it costs is charged to each
  // course's owner when the proposals are queued, which is where the spend
  // actually happens.
  enqueue("check_sources", { actorUserId: null });
}

async function run(job: Job): Promise<void> {
  const startedAt = Date.now();
  try {
    const handler = HANDLERS[job.type];
    if (!handler) throw new Error(`No handler for job type "${job.type}"`);
    const payload = JSON.parse(job.payloadJson) as { actorUserId?: unknown };
    log.info(`job ${job.id} (${job.type}) started`, { attempt: job.attempts });
    // Everything this job spends is charged to whoever queued it.
    const actorUserId =
      typeof payload.actorUserId === "string" ? payload.actorUserId : null;
    const result = actorUserId
      ? await withActor({ userId: actorUserId }, () => handler(payload))
      : await handler(payload);
    markDone(job.id, result);
    log.info(`job ${job.id} (${job.type}) done`, { ms: Date.now() - startedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markFailed(job, message);
    // If this was the last attempt, reflect the failure on the course. Only
    // for the build pipeline: a job that reworks a READY course (regenerating
    // one module, reading new material) failing must not sink the whole course
    // into "failed" and take it away from the students studying it.
    if (job.attempts >= job.maxAttempts && PIPELINE_JOBS.has(job.type)) {
      const courseId = jobCourseId(job.payloadJson);
      if (courseId) {
        db.update(courses)
          .set({ status: "failed" })
          .where(eq(courses.id, courseId))
          .run();
      }
    }
    log.error(`job ${job.id} (${job.type}) failed: ${message}`, {
      ms: Date.now() - startedAt,
      attempt: job.attempts,
      final: job.attempts >= job.maxAttempts,
    });
  }
}

/**
 * Take the scheduled backup, if one is due and nothing else is running.
 *
 * Deliberately on the idle branch, right after the checkpoint: a copy taken
 * while the pipeline is mid-course would be consistent but would land in the
 * middle of a build, and there is no hurry. Idle happens every second on any
 * install that is not permanently busy.
 *
 * A failure here is logged and dropped rather than thrown. The worker's job is
 * to build courses, and an unwritable backup directory must not stop it doing
 * that; the settings panel shows the last backup's age, which is where a
 * silently failing schedule becomes visible.
 */
async function backupIfDue(state: WorkerState): Promise<void> {
  if (!backupIsDue()) return;
  state.backupRunning = true;
  try {
    const record = await runBackup();
    log.info("scheduled backup", {
      file: record.file,
      courses: record.verified?.courses,
    });
  } catch (err) {
    log.error(
      `scheduled backup failed: ${err instanceof Error ? err.message : err}`,
    );
  } finally {
    state.backupRunning = false;
  }
}

export function startWorker(): void {
  if (globalForWorker.__ferrataWorker) return;

  // Pick up whatever the previous process was in the middle of. Only a build
  // pipeline job owns the course status, same rule as tick(): a rework job
  // interrupted on its last attempt must not sink a ready course and take it
  // away from the students studying it.
  const recovered = recoverOrphaned();
  for (const job of recovered.failed) {
    if (!PIPELINE_JOBS.has(job.type)) continue;
    const courseId = jobCourseId(job.payloadJson);
    if (courseId) {
      db.update(courses)
        .set({ status: "failed" })
        .where(eq(courses.id, courseId))
        .run();
    }
  }
  if (recovered.requeued > 0 || recovered.failed.length > 0) {
    log.warn("recovered jobs interrupted by a restart", {
      requeued: recovered.requeued,
      failed: recovered.failed.length,
    });
  }

  const state: WorkerState = { inFlight: new Map(), backupRunning: false };
  const timer = setInterval(() => {
    void tick(state);
  }, POLL_MS);
  // Do not keep the event loop alive solely for polling.
  if (typeof timer.unref === "function") timer.unref();
  globalForWorker.__ferrataWorker = { timer };
  log.info("started", { pollMs: POLL_MS, lanes: workerLanes() });
}
