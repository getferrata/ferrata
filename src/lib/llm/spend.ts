import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { concepts, courses, llmCalls, modules } from "@/db/schema";

/**
 * What a course actually cost, from the ledger.
 *
 * The estimate shown before building is a guess; this is the receipt. Having it
 * in the product matters more than having the guess be perfect, because an
 * author can check the claim instead of taking it on faith, and because the
 * estimate is corrected from these numbers rather than from a constant somebody
 * measured once.
 */

export interface CourseSpend {
  usd: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** Wall clock from the first call to the last, which is what the author waited. */
  elapsedMs: number;
  /** Sum of per-call latency, higher than elapsed only if calls overlapped. */
  modelMs: number;
  failedCalls: number;
}

export function courseSpend(courseId: string): CourseSpend | null {
  const row = db
    .select({
      usd: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`,
      calls: sql<number>`count(*)`,
      tokensIn: sql<number>`coalesce(sum(${llmCalls.tokensIn}), 0)`,
      tokensOut: sql<number>`coalesce(sum(${llmCalls.tokensOut}), 0)`,
      modelMs: sql<number>`coalesce(sum(${llmCalls.latencyMs}), 0)`,
      firstAt: sql<number>`min(${llmCalls.createdAt})`,
      lastAt: sql<number>`max(${llmCalls.createdAt})`,
      lastLatency: sql<number>`coalesce(max(${llmCalls.latencyMs}), 0)`,
      failedCalls: sql<number>`sum(case when ${llmCalls.ok} = 0 then 1 else 0 end)`,
    })
    .from(llmCalls)
    .where(eq(llmCalls.courseId, courseId))
    .get();

  if (!row || row.calls === 0) return null;
  return {
    usd: row.usd,
    calls: row.calls,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    // createdAt is stamped when a call starts, so the last one's duration has
    // to be added or the total stops short by one call.
    elapsedMs: Math.max(0, row.lastAt - row.firstAt) + row.lastLatency,
    modelMs: row.modelMs,
    failedCalls: row.failedCalls ?? 0,
  };
}

/**
 * Average cost of one finished module on this install, from courses that
 * actually finished.
 *
 * Better than a constant measured once elsewhere: it reflects this install's
 * model, its depth setting and the kind of material it is given. Null until
 * there is enough history to mean anything.
 */
export function measuredPerModuleUsd(minModules = 5): number | null {
  const row = db
    .select({
      usd: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`,
    })
    .from(llmCalls)
    .innerJoin(courses, eq(courses.id, llmCalls.courseId))
    .where(and(eq(courses.status, "ready"), isNotNull(llmCalls.courseId)))
    .get();

  const built = db
    .select({ n: sql<number>`count(*)` })
    .from(modules)
    .innerJoin(concepts, eq(concepts.id, modules.conceptId))
    .innerJoin(courses, eq(courses.id, concepts.courseId))
    .where(and(eq(courses.status, "ready"), eq(modules.status, "ready")))
    .get();

  const n = built?.n ?? 0;
  if (n < minModules || !row) return null;
  return row.usd / n;
}

/** "$1.09", "$0.42", or "free" when nothing was spent. */
export function formatUsd(usd: number): string {
  if (usd <= 0) return "free";
  if (usd < 0.01) return "under $0.01";
  return `$${usd.toFixed(2)}`;
}

/** "4m 12s", "38s". */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
