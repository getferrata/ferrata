import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { applyProposal, decideProposal } from "@/lib/course/proposals";

export const runtime = "nodejs";

interface Body {
  action?: unknown;
}

/**
 * POST /api/courses/:id/proposals/:proposalId: the author's decision on one
 * proposal. Approving is the only place a proposal becomes real: an update
 * queues a rewrite, an addition inserts the concept and queues its module, a
 * retirement records the cut and removes the concept. Dismissing just records
 * that the author read it and said no.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; proposalId: string }> },
): Promise<NextResponse> {
  const { id, proposalId } = await params;

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
  const action = body.action;
  if (action !== "approve" && action !== "dismiss") {
    return NextResponse.json(
      { error: "action must be approve or dismiss" },
      { status: 400 },
    );
  }

  // Marked decided first, so a double click cannot apply twice: the second
  // click finds nothing pending and stops here.
  const row = decideProposal(
    proposalId,
    id,
    action === "approve" ? "approved" : "dismissed",
    me.id,
  );
  if (!row) {
    return NextResponse.json({ error: "not pending" }, { status: 404 });
  }

  if (action === "dismiss") {
    return NextResponse.json({ ok: true, status: "dismissed" });
  }

  const applied = applyProposal(row, me.id);
  if (!applied.ok) {
    // Approved but unappliable (e.g. the concept was retired meanwhile). The
    // decision stands recorded; the author sees why nothing happened.
    return NextResponse.json({ ok: false, error: applied.error }, { status: 409 });
  }
  return NextResponse.json({ ok: true, status: "approved", effect: applied.effect });
}
