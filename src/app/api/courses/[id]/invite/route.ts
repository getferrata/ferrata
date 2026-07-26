import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { createInvite } from "@/lib/course/invite";

export const runtime = "nodejs";

/** POST /api/courses/:id/invite: examiner mints a shareable invite token. */
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
    return NextResponse.json({ error: "course not found" }, { status: 404 });
  }
  if (course.ownerId && course.ownerId !== me.id) {
    return NextResponse.json({ error: "not your course" }, { status: 403 });
  }
  const token = createInvite({ courseId: id, role: "student", createdBy: me.id });
  return NextResponse.json({ token, path: `/invito/${token}` }, { status: 201 });
}
