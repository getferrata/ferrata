import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";

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
  db.delete(users).where(eq(users.id, id)).run();
  return NextResponse.json({ ok: true });
}
