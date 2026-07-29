import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * Who may act on other people's accounts.
 *
 * "Examiner" says what someone does with courses, not what they may do to
 * colleagues. Treating the two as the same made every examiner able to reset
 * every other examiner's password, read the temporary one straight out of the
 * response, and sign in as them: their courses, and the provider key on the
 * settings page. Invites can mint examiners, so that was one invite away from
 * anybody.
 *
 * The operator is the account that set the install up. Acting on a student is
 * ordinary examiner work (assigning, resetting a forgotten password); acting on
 * another examiner is not.
 */
export function isOperator(userId: string): boolean {
  return (
    db
      .select({ op: users.isOperator })
      .from(users)
      .where(eq(users.id, userId))
      .get()?.op === true
  );
}

export type AdminVerdict =
  | { ok: true }
  | { ok: false; status: 403 | 404; error: string };

/**
 * May `actorId` administer `targetId`? Students are fair game for any examiner;
 * an examiner may only be administered by the operator.
 */
export function mayAdminister(
  actorId: string,
  targetId: string,
): AdminVerdict {
  const target = db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, targetId))
    .get();
  if (!target) return { ok: false, status: 404, error: "user not found" };
  if (target.role === "student") return { ok: true };
  if (isOperator(actorId)) return { ok: true };
  return {
    ok: false,
    status: 403,
    error:
      "Only the operator of this install can act on another author's account.",
  };
}
