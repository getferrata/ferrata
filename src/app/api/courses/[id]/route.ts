import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { concepts, courses, edges, enrollments, jobs, modules } from "@/db/schema";
import { deleteCourse } from "@/lib/course/list";
import { getCurrentUser } from "@/lib/auth/session";
import { canSeeCourse } from "@/lib/course/access";

export const runtime = "nodejs";

/**
 * DELETE /api/courses/:id: remove a course and everything under it. Only the
 * owner may delete; if students are enrolled it refuses (409) unless `?force=1`,
 * so nobody wipes an active onboarding cohort by accident.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const course = db.select().from(courses).where(eq(courses.id, id)).get();
  if (!course) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Ownerless (seed) courses are deletable by any examiner; owned ones only by
  // their owner.
  if (course.ownerId && course.ownerId !== user.id) {
    return NextResponse.json({ error: "not your course" }, { status: 403 });
  }

  const enrolled = db
    .select({ n: sql<number>`count(*)` })
    .from(enrollments)
    .where(eq(enrollments.courseId, id))
    .get()?.n ?? 0;

  const force = new URL(req.url).searchParams.get("force") === "1";
  if (enrolled > 0 && !force) {
    return NextResponse.json({ enrolled }, { status: 409 });
  }

  const ok = deleteCourse(id);
  return NextResponse.json({ ok, enrolled }, { status: ok ? 200 : 404 });
}

/** GET /api/courses/:id: course + extracted concepts, for status polling. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  // This feeds the wait screen, so it is polled constantly, and it returns the
  // course and its concepts. Same visibility rule as the pages.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  if (!canSeeCourse(id, { userId: user.id, role: user.role })) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const course = db.select().from(courses).where(eq(courses.id, id)).get();
  if (!course) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const rows = db
    .select()
    .from(concepts)
    .where(eq(concepts.courseId, id))
    .orderBy(asc(concepts.estimatedMinutes))
    .all();

  // Edges exist once the graph is built (status graphing→generating), so the
  // wait screen can show the prerequisite map taking shape, not just a list.
  const edgeRows = db
    .select({ from: edges.fromConceptId, to: edges.toConceptId })
    .from(edges)
    .where(eq(edges.courseId, id))
    .all();

  // On failure, surface the real reason (the latest failed job for this course)
  // instead of a generic message: a rate limit reads very differently from a
  // missing key.
  let lastError: string | null = null;
  if (course.status === "failed") {
    const failed = db
      .select({ error: jobs.error })
      .from(jobs)
      .where(and(eq(jobs.status, "failed"), like(jobs.payloadJson, `%"${id}"%`)))
      .orderBy(desc(jobs.updatedAt))
      .limit(1)
      .get();
    lastError = failed?.error ?? null;
  }

  // How many modules exist so far, so the wait screen can show live progress
  // ("modulo 3 di 6 scritto") instead of a frozen-looking spinner.
  const conceptIds = rows.map((c) => c.id);
  const modulesDone = conceptIds.length
    ? (db
        .select({ n: sql<number>`count(*)` })
        .from(modules)
        .where(inArray(modules.conceptId, conceptIds))
        .get()?.n ?? 0)
    : 0;

  return NextResponse.json({
    course,
    concepts: rows,
    edges: edgeRows,
    lastError,
    modulesDone,
    conceptCount: rows.length,
  });
}
