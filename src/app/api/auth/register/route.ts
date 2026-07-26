import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createSession, newUserId } from "@/lib/auth/session";
import { checkRegistration } from "@/lib/auth/registration";
import { consumeInvite } from "@/lib/course/invite";
import { checkThrottle, clientKey, recordFailure } from "@/lib/auth/throttle";

export const runtime = "nodejs";

// No role field: the role comes from the invite, never from the registrant.
const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(200),
  invite: z.string().optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data. The password must be at least 8 characters." },
      { status: 400 },
    );
  }
  const { email, name, password } = parsed.data;
  const normalized = email.trim().toLowerCase();

  // Invite tokens are 122-bit random, so guessing one is not realistic, but an
  // unlimited endpoint still lets someone hammer away at refusals.
  const throttleKey = `register:ip:${clientKey(req)}`;
  const throttled = checkThrottle(throttleKey);
  if (!throttled.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429, headers: { "retry-after": String(throttled.retryAfterSec) } },
    );
  }

  // Decided before anything is written: an install that is not open and has no
  // valid invite does not create the account at all.
  const verdict = checkRegistration(parsed.data.invite);
  if (!verdict.ok) {
    recordFailure(throttleKey);
    return NextResponse.json({ error: verdict.error }, { status: verdict.status });
  }

  const existing = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalized))
    .get();
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const effectiveRole = verdict.role;
  const id = newUserId();
  db.insert(users)
    .values({
      id,
      email: normalized,
      name: name.trim(),
      passwordHash: hashPassword(password),
      role: effectiveRole,
    })
    .run();

  await createSession(id);
  // The invite is spent here, not earlier: an account that failed to be created
  // must not burn someone's only link. Invited students land already enrolled.
  const courseId = verdict.inviteToken
    ? consumeInvite(verdict.inviteToken, id)
    : null;
  return NextResponse.json(
    { ok: true, role: effectiveRole, courseId },
    { status: 201 },
  );
}
