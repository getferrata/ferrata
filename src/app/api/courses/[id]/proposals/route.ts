import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, jobs, proposals } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * GET /api/courses/:id/proposals: the author's checklist, plus whether an
 * analysis is still running so the page can say "reading the material" instead
 * of showing an empty list that means nothing yet.
 */
export async function GET(
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

  const rows = db
    .select()
    .from(proposals)
    .where(eq(proposals.courseId, id))
    .all()
    .sort((a, b) => a.createdAt - b.createdAt);

  const analysing = db
    .select({ status: jobs.status, payloadJson: jobs.payloadJson })
    .from(jobs)
    .where(eq(jobs.type, "propose_updates"))
    .all()
    .some(
      (j) =>
        (j.status === "queued" || j.status === "running") &&
        j.payloadJson.includes(`"${id}"`),
    );

  return NextResponse.json({ proposals: rows, analysing });
}
