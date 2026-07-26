import { readInvite } from "@/lib/course/invite";
import { isFirstUser } from "@/lib/auth/session";
import type { UserRole } from "@/db/schema";

/**
 * Who is allowed to create an account.
 *
 * Closed by default: the first account becomes the examiner who sets the
 * install up, and after that an invite is the only way in. Building a course
 * spends on the install's provider key, so self-service sign-up on a server
 * anyone at the company can reach is a budget hole, not just a policy question.
 *
 * FERRATA_OPEN_REGISTRATION=1 reopens it for demos and public sandboxes.
 */

export function openRegistrationEnabled(): boolean {
  return process.env.FERRATA_OPEN_REGISTRATION === "1";
}

export type RegistrationVerdict =
  | { ok: true; role: UserRole; inviteToken: string | null }
  | { ok: false; status: 403; error: string };

export function checkRegistration(inviteToken?: string): RegistrationVerdict {
  // Somebody has to be able to start. The first account is the examiner.
  if (isFirstUser()) return { ok: true, role: "examiner", inviteToken: null };

  if (inviteToken) {
    const check = readInvite(inviteToken);
    if (check.ok) {
      // The role rides on the invite, so nobody chooses their own.
      return { ok: true, role: check.invite.role, inviteToken };
    }
    return { ok: false, status: 403, error: refusalMessage(check.reason) };
  }

  if (openRegistrationEnabled()) {
    return { ok: true, role: "student", inviteToken: null };
  }

  return {
    ok: false,
    status: 403,
    error:
      "This install is invite only. Ask whoever runs it for an invite link.",
  };
}

function refusalMessage(reason: "unknown" | "expired" | "used" | "revoked"): string {
  switch (reason) {
    case "expired":
      return "This invite has expired. Ask for a fresh link.";
    case "used":
      return "This invite has already been used. Ask for your own link.";
    case "revoked":
      return "This invite was revoked. Ask whoever runs this install.";
    default:
      return "This invite link is not valid. Check it, or ask for a new one.";
  }
}
