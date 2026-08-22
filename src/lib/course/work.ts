import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";

/**
 * What the worker owes this course, and what it already gave up on.
 *
 * "I clicked it and nothing happened" had no answer inside the app. The click
 * queues a job, the job runs somewhere else, and the page is a snapshot taken
 * before any of it: queued, running, failed three minutes ago and retried
 * twice all render as the same unchanged page. The only way to tell them
 * apart was to open the database, which is not a thing an author does.
 *
 * The three cases have different answers and that is the point of separating
 * them. Queued means wait. Running means wait, and here is how long it has
 * been. Failed means the click worked, the work did not, and here is the
 * reason, which is usually a key or a model and always something the author
 * can act on.
 */

export interface ActiveWork {
  type: string;
  status: "queued" | "running";
  /** When the row last changed: how long it has been waiting, or running. */
  since: number;
  /** The concept a module rewrite is about, for the ones that name one. */
  conceptId: string | null;
}

export interface FailedWork {
  type: string;
  error: string;
  at: number;
}

export interface CourseWork {
  /** Concept ids whose module has a rewrite queued or running. */
  rewriting: string[];
  active: ActiveWork[];
  /** The last failure per type, unless work of that type has since succeeded. */
  failed: FailedWork[];
}

/**
 * Where the rewrite of one module got to, which the module page needs and the
 * course-wide summary cannot answer: a failure there is filed under its job
 * type, and the author standing on the module wants to know about this module.
 *
 * The newest job for the concept tells the whole story, because a rewrite
 * replaces the module: an older attempt, however it ended, has been superseded
 * by whatever came after it.
 */
export type ModuleWork =
  | { state: "idle" }
  | { state: "queued" }
  | { state: "running"; since: number }
  | { state: "failed"; error: string; at: number };

export function moduleWork(conceptId: string): ModuleWork {
  const latest = db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.type, "regenerate_module"),
        like(jobs.payloadJson, `%"${conceptId}"%`),
      ),
    )
    .all()
    .filter((j) => j.payloadJson.includes(`"${conceptId}"`))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  if (!latest) return { state: "idle" };
  if (latest.status === "queued") return { state: "queued" };
  if (latest.status === "running") return { state: "running", since: latest.updatedAt };
  if (latest.status === "failed") {
    return {
      state: "failed",
      error: latest.error ?? "no reason recorded",
      at: latest.updatedAt,
    };
  }
  return { state: "idle" };
}

function conceptOf(payloadJson: string): string | null {
  try {
    const p = JSON.parse(payloadJson) as { conceptId?: unknown };
    return typeof p.conceptId === "string" ? p.conceptId : null;
  } catch {
    return null;
  }
}

/**
 * Matched on the payload rather than a column, because a job's course lives in
 * its payload. LIKE narrows the scan, and the substring check after it is what
 * decides: an id like course_a1b2 contains underscores, and to LIKE an
 * underscore is a wildcard matching any single character, so the pattern alone
 * would also match a different course whose id differs exactly there.
 *
 * The failure list is per type and self clearing: a failed build followed by a
 * successful retry has nothing left to report, and a stale red banner the
 * author has to learn to ignore is worse than no banner at all.
 */
export function courseWork(courseId: string): CourseWork {
  const rows = db
    .select()
    .from(jobs)
    .where(like(jobs.payloadJson, `%"${courseId}"%`))
    .all()
    .filter((j) => j.payloadJson.includes(`"${courseId}"`));

  const active: ActiveWork[] = [];
  const lastFailure = new Map<string, FailedWork>();
  const lastSuccess = new Map<string, number>();

  for (const j of rows) {
    if (j.status === "queued" || j.status === "running") {
      active.push({
        type: j.type,
        status: j.status,
        since: j.updatedAt,
        conceptId: conceptOf(j.payloadJson),
      });
      continue;
    }
    if (j.status === "done") {
      const at = lastSuccess.get(j.type) ?? 0;
      if (j.updatedAt > at) lastSuccess.set(j.type, j.updatedAt);
      continue;
    }
    const seen = lastFailure.get(j.type);
    if (!seen || j.updatedAt > seen.at) {
      lastFailure.set(j.type, {
        type: j.type,
        error: j.error ?? "no reason recorded",
        at: j.updatedAt,
      });
    }
  }

  const failed = [...lastFailure.values()]
    .filter((f) => f.at > (lastSuccess.get(f.type) ?? 0))
    .sort((a, b) => b.at - a.at);

  active.sort((a, b) => a.since - b.since);

  const rewriting = [
    ...new Set(
      active
        .filter((a) => a.type === "regenerate_module" && a.conceptId !== null)
        .map((a) => a.conceptId as string),
    ),
  ];

  return { rewriting, active, failed };
}
