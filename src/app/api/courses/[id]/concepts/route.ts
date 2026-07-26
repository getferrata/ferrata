import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { concepts, courses } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { enqueue } from "@/lib/jobs/queue";

export const runtime = "nodejs";

const schema = z.object({ dropIds: z.array(z.string()).default([]) });

/**
 * POST /api/courses/:id/concepts: confirm the concept selection after intake.
 * Drops the concepts the author unchecked, then resumes the pipeline
 * (build_graph → generate). Refuses to drop everything.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const course = db.select().from(courses).where(eq(courses.id, id)).get();
  if (!course) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (course.ownerId && course.ownerId !== user.id) {
    return NextResponse.json({ error: "not your course" }, { status: 403 });
  }
  if (course.status !== "concept_review") {
    return NextResponse.json({ error: "not under review" }, { status: 409 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid data" }, { status: 400 });
  }
  const dropIds = parsed.data.dropIds;

  const total = db
    .select({ n: sql<number>`count(*)` })
    .from(concepts)
    .where(eq(concepts.courseId, id))
    .get()?.n ?? 0;
  if (dropIds.length >= total) {
    return NextResponse.json(
      { error: "You must keep at least one concept." },
      { status: 400 },
    );
  }

  if (dropIds.length > 0) {
    db.delete(concepts)
      .where(and(eq(concepts.courseId, id), inArray(concepts.id, dropIds)))
      .run();
  }
  db.update(courses).set({ status: "graphing" }).where(eq(courses.id, id)).run();
  enqueue("build_graph", { courseId: id, actorUserId: user.id });

  return NextResponse.json({ ok: true, kept: total - dropIds.length });
}
