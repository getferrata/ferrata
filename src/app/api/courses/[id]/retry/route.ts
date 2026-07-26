import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { concepts, courses, edges, modules } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { enqueue } from "@/lib/jobs/queue";

export const runtime = "nodejs";

/**
 * POST /api/courses/:id/retry: pick a failed build back up.
 *
 * Generation is several stages and a failure can land in any of them, so the
 * stage to restart is worked out from what already exists rather than
 * remembered. Everything finished stays finished: module generation skips
 * concepts that already have a written and tested module, so a retry pays only
 * for the part that did not get done.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const course = db.select().from(courses).where(eq(courses.id, id)).get();
  if (!course) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (course.ownerId && course.ownerId !== me.id) {
    return NextResponse.json({ error: "not your course" }, { status: 403 });
  }
  if (course.status !== "failed") {
    return NextResponse.json(
      { error: "this course is not in a failed state" },
      { status: 409 },
    );
  }

  const conceptRows = db
    .select({ id: concepts.id })
    .from(concepts)
    .where(eq(concepts.courseId, id))
    .all();
  const hasEdges =
    db.select({ id: edges.id }).from(edges).where(eq(edges.courseId, id)).get() !==
    undefined;
  const written = conceptRows.filter(
    (c) =>
      db
        .select({ id: modules.id })
        .from(modules)
        .where(and(eq(modules.conceptId, c.id), eq(modules.status, "ready")))
        .get() !== undefined,
  ).length;

  // Furthest stage the course actually reached, so a retry does not redo the
  // interview because the writing failed.
  const [type, status] =
    conceptRows.length === 0
      ? course.interviewJson
        ? (["intake", "intake"] as const)
        : (["interview_questions", "interviewing"] as const)
      : hasEdges
        ? (["generate_course", "generating"] as const)
        : (["build_graph", "graphing"] as const);

  db.update(courses).set({ status }).where(eq(courses.id, id)).run();
  enqueue(type, { courseId: id, actorUserId: me.id });

  return NextResponse.json({ ok: true, stage: type, alreadyWritten: written });
}
