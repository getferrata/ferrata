import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { enrollByInvite } from "@/lib/course/invite";
import {
  checkThrottle,
  clearFailures,
  clientKey,
  recordFailure,
} from "@/lib/auth/throttle";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  invite: z.string().optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data." }, { status: 400 });
  }
  const email = parsed.data.email.trim().toLowerCase();

  // Throttle the email and the caller separately: a spoofed forwarded header
  // rotates one key, never both.
  const keys = [`login:email:${email}`, `login:ip:${clientKey(req)}`];
  for (const key of keys) {
    const verdict = checkThrottle(key);
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again in a few minutes." },
        { status: 429, headers: { "retry-after": String(verdict.retryAfterSec) } },
      );
    }
  }

  const user = db.select().from(users).where(eq(users.email, email)).get();
  // Same generic error whether the email exists or the password is wrong.
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    for (const key of keys) recordFailure(key);
    return NextResponse.json(
      { error: "Incorrect email or password." },
      { status: 401 },
    );
  }
  for (const key of keys) clearFailures(key);
  await createSession(user.id);
  const courseId = parsed.data.invite
    ? enrollByInvite(parsed.data.invite, user.id)
    : null;
  return NextResponse.json(
    { ok: true, role: user.role, courseId },
    { status: 200 },
  );
}
