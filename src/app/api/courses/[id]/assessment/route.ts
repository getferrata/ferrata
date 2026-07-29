import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

interface Body {
  mode?: unknown;
}

/**
 * POST /api/courses/:id/assessment: choose what this course's tests are for.
 *
 * "practice" is today's behaviour: students grade themselves, the dashboard
 * says so, and the number is a learning aid. "assessed" makes the number a
 * measurement: only answers the system checked count, over the questions it
 * can check. The examiner picks per course because the same course is a study
 * aid one month and a hiring gate the next.
 */
export async function POST(
  req: Request,
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

  const body = (await req.json().catch(() => ({}))) as Body;
  const mode = body.mode;
  if (mode !== "practice" && mode !== "assessed") {
    return NextResponse.json({ error: "mode must be practice or assessed" }, { status: 400 });
  }

  db.update(courses).set({ assessmentMode: mode }).where(eq(courses.id, id)).run();
  return NextResponse.json({ ok: true, mode });
}
