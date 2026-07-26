import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, packages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { now } from "@/lib/util/id";

export const runtime = "nodejs";

/**
 * POST /api/courses/:id/verify: an author says an imported course is fit to
 * teach here.
 *
 * Nothing is checked automatically, and that is the point. A package is
 * somebody else's writing about somebody else's systems; whether it matches how
 * things work in this company is a judgement only a person here can make. The
 * flag records that a named person made it.
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

  db.update(courses)
    .set({ verifiedAt: now(), verifiedBy: me.id })
    .where(eq(courses.id, id))
    .run();
  // The provenance ledger agrees with the course: this package is now trusted
  // on this install, by this person.
  db.update(packages)
    .set({ trusted: true })
    .where(eq(packages.courseId, id))
    .run();

  return NextResponse.json({ ok: true, verifiedBy: me.name });
}

/** DELETE: withdraw the verification, for when a review turns something up. */
export async function DELETE(
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
  db.update(courses)
    .set({ verifiedAt: null, verifiedBy: null })
    .where(eq(courses.id, id))
    .run();
  db.update(packages)
    .set({ trusted: false })
    .where(eq(packages.courseId, id))
    .run();
  return NextResponse.json({ ok: true });
}
