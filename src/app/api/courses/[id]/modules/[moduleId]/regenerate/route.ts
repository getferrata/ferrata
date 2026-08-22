import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { concepts, courses, modules } from "@/db/schema";
import { enqueueRegenerateModuleOnce } from "@/lib/jobs/queue";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * POST /api/courses/:id/modules/:moduleId/regenerate: rewrite one module with
 * the model, through the same quality loop as a build.
 *
 * This spends on the install's key and replaces the module's tests, which
 * clears the answers students gave on them. Both facts are in the confirm
 * dialog; neither is a side effect to discover later.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; moduleId: string }> },
): Promise<NextResponse> {
  const { id, moduleId } = await params;
  // Optional: rewrite against the questions this concept's readers get wrong.
  // A flag rather than the default, because on a module nobody has answered
  // there is no signal and the rewrite should not pretend there is.
  const body = (await req.json().catch(() => null)) as {
    useFailures?: unknown;
  } | null;
  const useFailures = body?.useFailures === true;

  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const course = db.select().from(courses).where(eq(courses.id, id)).get();
  if (!course) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (course.ownerId && course.ownerId !== me.id) {
    return NextResponse.json({ error: "not your course" }, { status: 403 });
  }
  // Only a finished course: during a build the pipeline owns the modules.
  if (course.status !== "ready") {
    return NextResponse.json({ error: "course not ready" }, { status: 409 });
  }

  const row = db
    .select({ conceptId: modules.conceptId, courseId: concepts.courseId })
    .from(modules)
    .innerJoin(concepts, eq(modules.conceptId, concepts.id))
    .where(eq(modules.id, moduleId))
    .get();
  if (!row || row.courseId !== id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Deduplicated against a rewrite already in flight for this concept, whether
  // it was queued here or by an approved proposal.
  const queued = enqueueRegenerateModuleOnce(
    id,
    row.conceptId,
    me.id,
    useFailures,
  );
  return NextResponse.json(
    { ok: true, alreadyQueued: !queued },
    { status: 202 },
  );
}
