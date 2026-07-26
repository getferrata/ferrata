import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { claimNext, markDone, markFailed, recoverOrphaned } from "./queue";
import { HANDLERS } from "./handlers";
import { getLogger } from "@/lib/log";
import { withActor } from "@/lib/llm/actor";

const log = getLogger("worker");

/**
 * In-process worker. Polls the jobs table on an interval and runs one job at a
 * time (the generation pipeline is sequential per course; a single lane keeps
 * SQLite writes simple and avoids hammering local LLMs). Booted once from
 * src/instrumentation.ts and kept on globalThis so HMR does not spawn copies.
 */

const POLL_MS = 1000;

const globalForWorker = globalThis as unknown as {
  __ferrataWorker?: { timer: NodeJS.Timeout; running: boolean };
};

async function tick(state: { running: boolean }): Promise<void> {
  if (state.running) return; // don't overlap ticks
  const job = claimNext();
  if (!job) return;
  state.running = true;
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
    // If this was the last attempt, reflect the failure on the course.
    if (job.attempts >= job.maxAttempts) {
      const courseId = safeCourseId(job.payloadJson);
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
  } finally {
    state.running = false;
  }
}

function safeCourseId(payloadJson: string): string | null {
  try {
    const p = JSON.parse(payloadJson) as { courseId?: unknown };
    return typeof p.courseId === "string" ? p.courseId : null;
  } catch {
    return null;
  }
}

export function startWorker(): void {
  if (globalForWorker.__ferrataWorker) return;

  // Pick up whatever the previous process was in the middle of.
  const recovered = recoverOrphaned();
  for (const job of recovered.failed) {
    const courseId = safeCourseId(job.payloadJson);
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

  const state = { running: false };
  const timer = setInterval(() => {
    void tick(state);
  }, POLL_MS);
  // Do not keep the event loop alive solely for polling.
  if (typeof timer.unref === "function") timer.unref();
  globalForWorker.__ferrataWorker = { timer, running: false };
  log.info("started", { pollMs: POLL_MS });
}
