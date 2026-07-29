import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { mayAdminister } from "@/lib/auth/operator";
import { courses } from "@/db/schema";

export const runtime = "nodejs";

const patchSchema = z.object({ role: z.enum(["student", "examiner"]) });

/** PATCH /api/users/:id: examiner changes a user's role. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  if (id === me.id) {
    return NextResponse.json(
      { error: "you can't change your own role" },
      { status: 400 },
    );
  }
  // Demoting another examiner to student takes their courses away from them
  // (access is owner-scoped), which is the same power as a takeover wearing a
  // different hat.
  const patchVerdict = mayAdminister(me.id, id);
  if (!patchVerdict.ok) {
    return NextResponse.json(
      { error: patchVerdict.error },
      { status: patchVerdict.status },
    );
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  db.update(users).set({ role: parsed.data.role }).where(eq(users.id, id)).run();
  return NextResponse.json({ ok: true, role: parsed.data.role });
}

/** DELETE /api/users/:id: examiner removes a user (cascades their data). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me || me.role !== "examiner") {
    return NextResponse.json({ error: "examiners only" }, { status: 403 });
  }
  if (id === me.id) {
    return NextResponse.json(
      { error: "you can't delete yourself" },
      { status: 400 },
    );
  }
  const delVerdict = mayAdminister(me.id, id);
  if (!delVerdict.ok) {
    return NextResponse.json(
      { error: delVerdict.error },
      { status: delVerdict.status },
    );
  }
  // Courses carry an owner id but no foreign key, so deleting the owner used to
  // leave the course pointing at somebody who no longer exists: no examiner
  // could open, rework, export or remove it ever again, while its students kept
  // studying it. Ownership moves to whoever is doing the deleting, in the same
  // transaction, so an author leaving the company does not strand their work.
  db.transaction((tx) => {
    tx.update(courses)
      .set({ ownerId: me.id })
      .where(eq(courses.ownerId, id))
      .run();
    tx.delete(users).where(eq(users.id, id)).run();
  });
  return NextResponse.json({ ok: true });
}
