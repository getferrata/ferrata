import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";

export const runtime = "nodejs";

/**
 * POST /api/users/:id/password: examiner resets a user's password. With no
 * email, we generate a temporary password and return it ONCE for the examiner
 * to relay; it is stored only as a hash.
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
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return NextResponse.json({ error: "user not found" }, { status: 404 });

  // Readable temporary password (base64url of 9 bytes ≈ 12 chars).
  const temp = randomBytes(9).toString("base64url");
  db.update(users)
    .set({ passwordHash: hashPassword(temp) })
    .where(eq(users.id, id))
    .run();
  return NextResponse.json({ ok: true, temporaryPassword: temp });
}
