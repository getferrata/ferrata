import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { concepts, courses, modules } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { now } from "@/lib/util/id";

export const runtime = "nodejs";

/** Long enough for a real module, short enough that a paste-bomb is refused. */
const MAX_BODY = 200_000;

interface Body {
  bodyMd?: unknown;
}

/**
 * PATCH /api/courses/:id/modules/:moduleId: rewrite one module by hand.
 *
 * A finished course was frozen: the only way to change a sentence was to delete
 * the course and pay to build it again. Most corrections are one line, and the
 * author usually knows the right line better than the model does.
 *
 * Costs nothing and calls no model, so it is the cheapest correction available
 * and deliberately the first one.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; moduleId: string }> },
): Promise<NextResponse> {
  const { id, moduleId } = await params;

  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }

  const course = db.select().from(courses).where(eq(courses.id, id)).get();
  if (!course) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (course.ownerId && course.ownerId !== me.id) {
    return NextResponse.json({ error: "not your course" }, { status: 403 });
  }

  // The module has to belong to THIS course: the id is in the URL and ids are
  // guessable, so editing somebody else's module through your own course would
  // otherwise be a matter of changing one path segment.
  const row = db
    .select({ id: modules.id, courseId: concepts.courseId })
    .from(modules)
    .innerJoin(concepts, eq(modules.conceptId, concepts.id))
    .where(eq(modules.id, moduleId))
    .get();
  if (!row || row.courseId !== id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const bodyMd = typeof body.bodyMd === "string" ? body.bodyMd : null;
  if (bodyMd === null) {
    return NextResponse.json({ error: "bodyMd required" }, { status: 400 });
  }
  if (!bodyMd.trim()) {
    return NextResponse.json(
      { error: "A module cannot be empty. Delete the concept instead." },
      { status: 400 },
    );
  }
  if (bodyMd.length > MAX_BODY) {
    return NextResponse.json(
      { error: `A module is capped at ${MAX_BODY} characters.` },
      { status: 400 },
    );
  }

  db.update(modules)
    .set({ bodyMd, status: "ready", editedAt: now(), editedBy: me.id })
    .where(eq(modules.id, moduleId))
    .run();

  return NextResponse.json({ ok: true });
}
