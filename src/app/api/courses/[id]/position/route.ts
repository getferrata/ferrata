import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { enrollments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

const schema = z.object({ moduleId: z.string().min(1) });

/**
 * POST /api/courses/:id/position: record the last module a student opened, so
 * the course can resume where they left off. A no-op for anyone who is not an
 * enrolled student of this course (owners and examiners just read).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const enrollment = db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, id), eq(enrollments.userId, me.id)))
    .get();
  // Only enrolled students carry a bookmark; everyone else is just reading.
  if (!enrollment) return NextResponse.json({ ok: true });

  db.update(enrollments)
    .set({ lastModuleId: parsed.data.moduleId, lastSeenAt: Date.now() })
    .where(eq(enrollments.id, enrollment.id))
    .run();

  return NextResponse.json({ ok: true });
}
