import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/auth/authenticate";
import { withHashSlot } from "@/lib/auth/gate";
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

  // The email is always throttled: it is the thing being guessed, and the
  // attacker cannot rotate it. The caller address is added only when there is a
  // trustworthy one (see clientKey); keying every caller under one name would
  // let eight failures from anywhere refuse everybody.
  const ip = clientKey(req);
  const keys = [
    `login:email:${email}`,
    ...(ip ? [`login:ip:${ip}`] : []),
  ];
  for (const key of keys) {
    const verdict = checkThrottle(key);
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again in a few minutes." },
        { status: 429, headers: { "retry-after": String(verdict.retryAfterSec) } },
      );
    }
  }

  // Same generic error, and the same time, whether the email exists or not.
  const outcome = await withHashSlot(async () => ({
    user: await authenticate(email, parsed.data.password),
  }));
  if (!outcome) {
    return NextResponse.json(
      { error: "Too many sign-ins at once. Try again in a moment." },
      { status: 429, headers: { "retry-after": "5" } },
    );
  }
  const user = outcome.user;
  if (!user) {
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
