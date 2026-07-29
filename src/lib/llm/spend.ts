import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
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
  /**
   * Calls whose model was not in the price table, so their cost is the
   * conservative fallback rate. A figure built partly from a guess should say
   * which part, rather than presenting a precision it does not have.
   */
  estimatedCalls: number;
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
      estimatedCalls: sql<number>`sum(case when ${llmCalls.priceKnown} = 0 then 1 else 0 end)`,
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
    estimatedCalls: row.estimatedCalls ?? 0,
  };
}

/**
 * Average cost of one finished module on this install, for a given writing
 * model, from courses that actually finished with that model.
 *
 * Better than a constant measured once elsewhere: it reflects this install's
 * depth setting and the kind of material it is given. Null until there is
 * enough history to mean anything.
 *
 * Scoped to the model on purpose. An average over every course ever built here
 * is blind to which model built them, so an install with a history of expensive
 * courses kept quoting that price after the operator switched to a cheaper
 * model: the estimate simply did not move, and the one number the product offers
 * before spending money was wrong in the direction that matters. With no history
 * for the model in question the caller falls back to the price table, which at
 * least tracks the choice.
 */
export function measuredPerModuleUsd(
  model: string,
  minModules = 5,
): number | null {
  // Courses this model wrote the modules for. A course whose modules were
  // written by more than one model (the operator switched mid-build) is left
  // out rather than attributed to either.
  const byCourse = db
    .select({ courseId: llmCalls.courseId, model: llmCalls.model })
    .from(llmCalls)
    .where(and(eq(llmCalls.task, "write_module"), isNotNull(llmCalls.courseId)))
    .all();
  const models = new Map<string, Set<string>>();
  for (const r of byCourse) {
    if (!r.courseId) continue;
    const set = models.get(r.courseId) ?? new Set<string>();
    set.add(r.model);
    models.set(r.courseId, set);
  }
  const ids = [...models.entries()]
    .filter(([, set]) => set.size === 1 && set.has(model))
    .map(([id]) => id);
  if (ids.length === 0) return null;

  const row = db
    .select({ usd: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` })
    .from(llmCalls)
    .innerJoin(courses, eq(courses.id, llmCalls.courseId))
    .where(and(eq(courses.status, "ready"), inArray(llmCalls.courseId, ids)))
    .get();

  const built = db
    .select({ n: sql<number>`count(*)` })
    .from(modules)
    .innerJoin(concepts, eq(concepts.id, modules.conceptId))
    .innerJoin(courses, eq(courses.id, concepts.courseId))
    .where(
      and(
        eq(courses.status, "ready"),
        eq(modules.status, "ready"),
        inArray(concepts.courseId, ids),
      ),
    )
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
