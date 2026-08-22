import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { courseGaps } from "@/lib/course/gaps";
import { enqueueRegenerateModuleOnce } from "@/lib/jobs/queue";

/**
 * POST /api/courses/:id/gaps: write the modules a finished course is missing.
 *
 * One action for exactly what the panel lists. Each gap is queued as the module
 * rewrite that already exists, which is keyed by concept rather than by module
 * and so covers a concept that never got one at all, and which deduplicates
 * against a rewrite already in flight.
 *
 * It spends: one module per gap. The button says so, because an author clicking
 * a fix should not discover the price afterwards.
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
  if (!course) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (course.ownerId && course.ownerId !== me.id) {
    return NextResponse.json({ error: "not your course" }, { status: 403 });
  }
  // Only a finished course: while the build runs the pipeline owns the modules,
  // and what looks like a gap from here is the normal middle of a build.
  if (course.status !== "ready") {
    return NextResponse.json({ error: "course not ready" }, { status: 409 });
  }

  const gaps = courseGaps(id);
  const conceptIds = [
    ...new Set([
      ...gaps.missing.map((g) => g.conceptId),
      ...gaps.untested.map((g) => g.conceptId),
    ]),
  ];
  let queued = 0;
  for (const conceptId of conceptIds) {
    if (enqueueRegenerateModuleOnce(id, conceptId, me.id)) queued++;
  }
  return NextResponse.json(
    { ok: true, queued, alreadyQueued: conceptIds.length - queued },
    { status: 202 },
  );
}
