import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { enqueue } from "@/lib/jobs/queue";
import { newId } from "@/lib/util/id";
import { planTask } from "@/lib/llm/registry";
import { toCompatibilityRow } from "@/lib/llm/preflight/publish";
import type { PreflightReport } from "@/lib/llm/preflight/report";

export const runtime = "nodejs";

/**
 * The preflight: one pass through the pipeline on a fixture, with the models
 * currently selected, so an operator learns whether this model works with
 * Ferrata before a course is paid for rather than partway through one.
 *
 * Examiners only, and it spends on the install's key like any other generation,
 * which is why it goes through the same actor and the same credit ceiling.
 */

function isRunning(userId: string): boolean {
  // Queued AND running. A job is queued for the second or two before the worker
  // claims it and running for the minute or three it takes, so asking only
  // about "queued" left the guard closed for almost none of the window it was
  // written to cover: a second click, or a reload, queued another eight billed
  // calls on the install's key.
  return Boolean(
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, "preflight"),
          inArray(jobs.status, ["queued", "running"]),
          eq(jobs.actorUserId, userId),
        ),
      )
      .get(),
  );
}

/** POST /api/settings/preflight: queue a run. */
export async function POST(): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  // One at a time per person. Two runs would bill twice for the same answer,
  // and the second would report on a model the first is already testing.
  if (isRunning(me.id)) {
    return NextResponse.json(
      { error: "a preflight is already running" },
      { status: 409 },
    );
  }
  const runId = newId("pf");
  const jobId = enqueue(
    "preflight",
    { actorUserId: me.id, runId },
    // A failed stage is the answer, not a reason to run the whole thing again
    // on the operator's money.
    { maxAttempts: 1 },
  );
  return NextResponse.json({ jobId });
}

/** GET /api/settings/preflight: the latest run for this person, with its report. */
export async function GET(req: Request): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const wanted = new URL(req.url).searchParams.get("jobId");
  // Scoped in the query rather than fetched and checked after. Another
  // examiner's run is not this one's to read: the report carries what the
  // install spends and on which model.
  const mine = and(eq(jobs.type, "preflight"), eq(jobs.actorUserId, me.id));
  const row = db
    .select()
    .from(jobs)
    .where(wanted ? and(mine, eq(jobs.id, wanted)) : mine)
    .orderBy(desc(jobs.createdAt))
    .limit(1)
    .get();

  if (!row) return NextResponse.json({ status: "none" });
  const report = row.resultJson
    ? (JSON.parse(row.resultJson) as PreflightReport)
    : null;
  // The row an operator may choose to publish, computed here rather than in the
  // browser so what leaves the machine is decided by one function with tests on
  // it. Offered, never sent: nothing here posts it anywhere.
  const plan = planTask("write_module");
  return NextResponse.json({
    jobId: row.id,
    status: row.status,
    error: row.error,
    report,
    publishable: report
      ? toCompatibilityRow(report, plan.model, plan.providerName)
      : null,
  });
}
