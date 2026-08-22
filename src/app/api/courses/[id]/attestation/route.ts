import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { buildAttestation } from "@/lib/course/attestation";

export const runtime = "nodejs";

/**
 * GET /api/courses/:id/attestation?studentId=… : the signed record for one
 * student, as JSON.
 *
 * JSON as well as the page, because the point of signing it is that somebody
 * else can check it. A PDF of a number is a picture of a claim; this is the
 * claim with its evidence and its signature, in a form an auditor's own script
 * can verify without asking this install anything.
 *
 * A student may fetch their own and nobody else's. An examiner may fetch any on
 * a course they own: it is a record about a person, so the same rule the
 * dashboard uses applies here, where the stakes are higher.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });

  const studentId =
    new URL(req.url).searchParams.get("studentId") ?? me.id;

  if (me.role !== "examiner" && studentId !== me.id) {
    return NextResponse.json({ error: "not your record" }, { status: 403 });
  }

  const course = db.select().from(courses).where(eq(courses.id, id)).get();
  if (!course) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (me.role === "examiner" && course.ownerId && course.ownerId !== me.id) {
    return NextResponse.json({ error: "not your course" }, { status: 403 });
  }

  const doc = buildAttestation(id, studentId);
  if (!doc) {
    return NextResponse.json({ error: "no such student" }, { status: 404 });
  }
  return NextResponse.json(doc);
}
