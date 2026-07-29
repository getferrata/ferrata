import { eq } from "drizzle-orm";
import { db } from "@/db";
import { llmCalls } from "@/db/schema";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";

/**
 * What a preflight found, read back out of the ledger rather than tallied as it
 * goes. The ledger is what bills the operator, so it is also what should answer
 * the question, and a report built from it cannot disagree with the receipt.
 */

export interface StageReport {
  task: string;
  /** The stage produced something the schema accepted. */
  ok: boolean;
  /** Calls billed for this stage. More than one means attempts were thrown away. */
  calls: number;
  /** Calls billed and discarded. Zero is the only good number. */
  wasted: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** The longest answer reached the stage's ceiling, which is what causes waste. */
  hitCap: boolean;
  cap: number | null;
  /**
   * Why the discarded calls were discarded, deduplicated. A count of wasted
   * calls tells an operator to change something without telling them what: a
   * schema rule rejecting a good answer and a ceiling set too low look
   * identical on the bill and need opposite fixes.
   */
  reasons: string[];
}

export type Verdict = "clean" | "wasteful" | "broken";

export interface PreflightReport {
  stages: StageReport[];
  totalUsd: number;
  totalCalls: number;
  wastedCalls: number;
  wastedUsd: number;
  verdict: Verdict;
  /** Stages that were expected and produced no row at all. */
  missing: string[];
  /** Set when a stage threw; the operator needs the message, not just a flag. */
  errors: { task: string; message: string }[];
}

function capFor(task: string): number | null {
  return task in OUTPUT_CAPS
    ? OUTPUT_CAPS[task as keyof typeof OUTPUT_CAPS]
    : null;
}

/**
 * Build the report from the ledger rows tagged with this run.
 *
 * `expected` is passed in rather than derived from the rows: a stage that never
 * managed a single call leaves no row behind, and silently omitting it would
 * turn the worst outcome into an empty space on the screen.
 */
export function buildReport(
  tag: string,
  expected: string[],
  errors: { task: string; message: string }[] = [],
): PreflightReport {
  const rows = db
    .select()
    .from(llmCalls)
    .where(eq(llmCalls.courseId, tag))
    .all();

  const stages: StageReport[] = [];
  const missing: string[] = [];

  for (const task of expected) {
    const mine = rows.filter((r) => r.task === task);
    if (mine.length === 0) {
      missing.push(task);
      continue;
    }
    const kept = mine.filter((r) => r.ok);
    const cap = capFor(task);
    const longest = Math.max(...mine.map((r) => r.tokensOut));
    const reasons = [
      ...new Set(
        mine
          .filter((r) => !r.ok && r.error)
          .map((r) => (r.error as string).slice(0, 200)),
      ),
    ];
    stages.push({
      task,
      ok: kept.length > 0,
      calls: mine.length,
      wasted: mine.length - kept.length,
      tokensIn: mine.reduce((n, r) => n + r.tokensIn, 0),
      tokensOut: mine.reduce((n, r) => n + r.tokensOut, 0),
      costUsd: mine.reduce((n, r) => n + r.costUsd, 0),
      hitCap: cap !== null && longest >= cap,
      cap,
      reasons,
    });
  }

  const wastedUsd = rows
    .filter((r) => !r.ok)
    .reduce((n, r) => n + r.costUsd, 0);
  const wastedCalls = rows.filter((r) => !r.ok).length;

  // A stage that never answered is the only failure that matters; waste is a
  // bill, not a broken install, and the two deserve different words.
  const broken = missing.length > 0 || stages.some((s) => !s.ok);
  const wasteful = stages.some((s) => s.wasted > 0 || s.hitCap);

  return {
    stages,
    totalUsd: rows.reduce((n, r) => n + r.costUsd, 0),
    totalCalls: rows.length,
    wastedCalls,
    wastedUsd,
    verdict: broken ? "broken" : wasteful ? "wasteful" : "clean",
    missing,
    errors,
  };
}
