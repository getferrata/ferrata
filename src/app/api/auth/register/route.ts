import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { enrollments, invites, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createSession, newUserId } from "@/lib/auth/session";
import { checkRegistration } from "@/lib/auth/registration";
import { newId, now } from "@/lib/util/id";
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
  const { email, name, password, invite } = parsed.data;
  const normalized = email.trim().toLowerCase();

  // Invite tokens are 122-bit random, so guessing one is not realistic, but an
  // unlimited endpoint still lets someone hammer away at refusals. Keyed on the
  // caller when there is a trustworthy address, otherwise on the token being
  // presented: retrying one spent invite is the realistic case, and it is the
  // one thing an attacker cannot vary without abandoning the attempt.
  const ip = clientKey(req);
  const throttleKey = ip
    ? `register:ip:${ip}`
    : `register:invite:${invite ?? "none"}`;
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

  const effectiveRole = verdict.role;
  const id = newUserId();
  // Hashed before the transaction: scrypt is async now (it must not block the
  // event loop), and the claim-and-insert transaction below is synchronous.
  const passwordHash = await hashPassword(password);

  // The duplicate-email check, the single-use invite claim, and the user insert
  // are one synchronous transaction. better-sqlite3 runs it without yielding, so
  // two registrations racing on the same invite cannot both create an account:
  // the second finds the invite already used and is rejected. The old flow
  // claimed the invite only after `await createSession`, a window in which one
  // examiner link could mint several examiner accounts.
  let courseId: string | null = null;
  let refusal: { error: string; status: number; throttle?: boolean } | null =
    null;
  try {
    db.transaction((tx) => {
      const existing = tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalized))
        .get();
      if (existing) {
        refusal = {
          error: "An account with this email already exists.",
          status: 409,
        };
        throw new Error("abort");
      }

      // First-user-becomes-examiner, re-checked inside the transaction so two
      // simultaneous first registrations cannot both seize the examiner role.
      // The same check decides who is the operator: the person who set the
      // install up, and the only account allowed to act on other accounts.
      let isOperator = false;
      if (effectiveRole === "examiner" && !verdict.inviteToken) {
        const anyUser = tx.select({ id: users.id }).from(users).get();
        isOperator = !anyUser;
        if (anyUser) {
          refusal = {
            error:
              "This install is invite only. Ask whoever runs it for an invite link.",
            status: 403,
          };
          throw new Error("abort");
        }
      }

      if (verdict.inviteToken) {
        // Conditional claim: succeeds only if the invite is still unused, not
        // revoked, and not expired. Zero rows means someone else just took it.
        const claimed = tx
          .update(invites)
          .set({ usedAt: now(), usedBy: id })
          .where(
            and(
              eq(invites.id, verdict.inviteToken),
              isNull(invites.usedAt),
              isNull(invites.revokedAt),
              gt(invites.expiresAt, now()),
            ),
          )
          .returning({ courseId: invites.courseId })
          .all();
        if (claimed.length === 0) {
          refusal = {
            error: "This invite has already been used. Ask for your own link.",
            status: 409,
            throttle: true,
          };
          throw new Error("abort");
        }
        courseId = claimed[0]?.courseId ?? null;
      }

      tx.insert(users)
        .values({
          id,
          email: normalized,
          name: name.trim(),
          passwordHash,
          role: effectiveRole,
          isOperator,
        })
        .run();

      // Invited students land already enrolled in the course the invite named.
      if (courseId) {
        const enr = tx
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(
            and(
              eq(enrollments.courseId, courseId),
              eq(enrollments.userId, id),
            ),
          )
          .get();
        if (!enr) {
          tx.insert(enrollments)
            .values({ id: newId("enr"), courseId, userId: id })
            .run();
        }
      }
    });
  } catch (err) {
    if (refusal) {
      const r: { error: string; status: number; throttle?: boolean } = refusal;
      if (r.throttle) recordFailure(throttleKey);
      return NextResponse.json({ error: r.error }, { status: r.status });
    }
    throw err;
  }

  await createSession(id);
  return NextResponse.json(
    { ok: true, role: effectiveRole, courseId },
    { status: 201 },
  );
}
