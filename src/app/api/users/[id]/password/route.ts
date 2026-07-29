import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { mayAdminister } from "@/lib/auth/operator";
import { hashPassword } from "@/lib/auth/password";
import { getLogger } from "@/lib/log";

const log = getLogger("auth");

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
  // Resetting a password hands over an account, and the response carries the
  // new one in the clear. Any examiner being able to do that to any other
  // examiner is a takeover, not an administrative convenience.
  const verdict = mayAdminister(me.id, id);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error }, { status: verdict.status });
  }
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return NextResponse.json({ error: "user not found" }, { status: 404 });

  // Readable temporary password (base64url of 9 bytes, about 12 chars).
  const temp = randomBytes(9).toString("base64url");
  db.update(users)
    .set({ passwordHash: await hashPassword(temp) })
    .where(eq(users.id, id))
    .run();
  // Leaves a trace on purpose: a password reset is the one action here that
  // transfers control of an account, so it should not be possible to do it
  // quietly.
  log.warn(`password reset for ${target.email} by ${me.email}`);
  return NextResponse.json({ ok: true, temporaryPassword: temp });
}
