import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, enrollments, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { newId } from "@/lib/util/id";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().email(),
  // Optional per-student deadline as an ISO date (yyyy-mm-dd).
  deadline: z.string().optional(),
});

/** POST /api/courses/:id/enroll: examiner enrolls a registered student by email. */
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
  if (!course) return NextResponse.json({ error: "course not found" }, { status: 404 });
  if (course.ownerId && course.ownerId !== me.id) {
    return NextResponse.json({ error: "not your course" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  const email = parsed.data.email.trim().toLowerCase();
  const student = db.select().from(users).where(eq(users.email, email)).get();
  if (!student) {
    return NextResponse.json(
      {
        error:
          "No account with this email. Send them an invite link instead: they will land in this course once they sign up.",
      },
      { status: 404 },
    );
  }

  const deadlineMs = parsed.data.deadline
    ? Date.parse(parsed.data.deadline)
    : NaN;
  const deadline = Number.isFinite(deadlineMs) ? deadlineMs : null;

  const existing = db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, id), eq(enrollments.userId, student.id)))
    .get();
  if (existing) {
    db.update(enrollments).set({ deadline }).where(eq(enrollments.id, existing.id)).run();
  } else {
    db.insert(enrollments)
      .values({ id: newId("enr"), courseId: id, userId: student.id, deadline })
      .run();
  }
  return NextResponse.json(
    { ok: true, student: { name: student.name, email: student.email } },
    { status: 201 },
  );
}

/** DELETE /api/courses/:id/enroll?userId=: examiner un-enrolls a student. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  const course = db.select().from(courses).where(eq(courses.id, id)).get();
  if (!course) return NextResponse.json({ error: "course not found" }, { status: 404 });
  if (course.ownerId && course.ownerId !== me.id) {
    return NextResponse.json({ error: "not your course" }, { status: 403 });
  }
  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "missing userId" }, { status: 400 });

  db.delete(enrollments)
    .where(and(eq(enrollments.courseId, id), eq(enrollments.userId, userId)))
    .run();
  return NextResponse.json({ ok: true });
}
