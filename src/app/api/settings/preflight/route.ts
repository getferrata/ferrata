import { and, desc, eq, like } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { enqueue } from "@/lib/jobs/queue";
import { newId } from "@/lib/util/id";

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
  return Boolean(
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, "preflight"),
          eq(jobs.status, "queued"),
          like(jobs.payloadJson, `%"${userId}"%`),
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
  const row = db
    .select()
    .from(jobs)
    .where(
      wanted
        ? and(eq(jobs.id, wanted), eq(jobs.type, "preflight"))
        : and(
            eq(jobs.type, "preflight"),
            like(jobs.payloadJson, `%"${me.id}"%`),
          ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(1)
    .get();

  if (!row) return NextResponse.json({ status: "none" });
  // Another examiner's run is not this examiner's to read: the report carries
  // what the install spends and on which model.
  if (!row.payloadJson.includes(`"${me.id}"`)) {
    return NextResponse.json({ status: "none" });
  }
  return NextResponse.json({
    jobId: row.id,
    status: row.status,
    error: row.error,
    report: row.resultJson ? JSON.parse(row.resultJson) : null,
  });
}
