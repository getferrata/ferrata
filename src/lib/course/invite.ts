import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { courses, enrollments, invites, users, type UserRole } from "@/db/schema";
import { newId, now } from "@/lib/util/id";

/**
 * Invites are the way in. Once the first account exists nobody registers on
 * their own, so an invite decides the role rather than the person arriving,
 * expires, and burns on use: a link forwarded to a group chat is worth nothing
 * to the second person who opens it.
 */

/** Three days. Long enough to survive a weekend, short enough to matter. */
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

export interface NewInvite {
  /** Set to also enroll the new account in a course. */
  courseId?: string | null;
  role?: UserRole;
  createdBy: string;
  ttlMs?: number;
}

export function createInvite(opts: NewInvite): string {
  const id = newId("inv");
  db.insert(invites)
    .values({
      id,
      courseId: opts.courseId ?? null,
      role: opts.role ?? "student",
      createdBy: opts.createdBy,
      expiresAt: now() + (opts.ttlMs ?? INVITE_TTL_MS),
    })
    .run();
  return id;
}

export type InviteRefusal = "unknown" | "expired" | "used" | "revoked";

export interface InviteInfo {
  token: string;
  courseId: string | null;
  courseTitle: string | null;
  role: UserRole;
  expiresAt: number;
}

/**
 * Resolve a token to a usable invite, or say why it is not usable. The reason
 * matters to the person holding the link, who otherwise cannot tell "I mistyped
 * this" from "someone already used it".
 */
export function readInvite(
  token: string,
): { ok: true; invite: InviteInfo } | { ok: false; reason: InviteRefusal } {
  const row = db
    .select({
      id: invites.id,
      courseId: invites.courseId,
      role: invites.role,
      expiresAt: invites.expiresAt,
      usedAt: invites.usedAt,
      revokedAt: invites.revokedAt,
      title: courses.title,
    })
    .from(invites)
    .leftJoin(courses, eq(courses.id, invites.courseId))
    .where(eq(invites.id, token))
    .get();
  if (!row) return { ok: false, reason: "unknown" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt <= now()) return { ok: false, reason: "expired" };
  return {
    ok: true,
    invite: {
      token: row.id,
      courseId: row.courseId,
      courseTitle: row.title ?? null,
      role: row.role,
      expiresAt: row.expiresAt,
    },
  };
}

/**
 * Spend an invite on a brand new account: mark it used and enroll if it named a
 * course. The update is conditional on the invite still being unused, so two
 * registrations racing on the same link cannot both win.
 */
export function consumeInvite(token: string, userId: string): string | null {
  if (!readInvite(token).ok) return null;
  const claimed = db
    .update(invites)
    .set({ usedAt: now(), usedBy: userId })
    .where(and(eq(invites.id, token), isNull(invites.usedAt)))
    .returning({ courseId: invites.courseId })
    .all();
  if (claimed.length === 0) return null;
  const courseId = claimed[0]?.courseId ?? null;
  if (courseId) enroll(courseId, userId);
  return courseId;
}

/**
 * Enroll an already signed-in account from an invite link, single use. The claim
 * is a conditional update on the invite still being unused, so a forwarded link
 * is worth nothing to the second person who opens it, and the same account
 * cannot self-enroll into a course it was never given more than once.
 */
export function enrollByInvite(token: string, userId: string): string | null {
  const check = readInvite(token);
  if (!check.ok || !check.invite.courseId) return null;
  const claimed = db
    .update(invites)
    .set({ usedAt: now(), usedBy: userId })
    .where(and(eq(invites.id, token), isNull(invites.usedAt)))
    .returning({ courseId: invites.courseId })
    .all();
  if (claimed.length === 0) return null;
  const courseId = claimed[0]?.courseId ?? check.invite.courseId;
  enroll(courseId, userId);
  return courseId;
}

function enroll(courseId: string, userId: string): void {
  const existing = db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(eq(enrollments.courseId, courseId), eq(enrollments.userId, userId)),
    )
    .get();
  if (existing) return;
  db.insert(enrollments)
    .values({ id: newId("enr"), courseId, userId })
    .run();
}

export function revokeInvite(token: string): void {
  db.update(invites)
    .set({ revokedAt: now() })
    .where(and(eq(invites.id, token), isNull(invites.revokedAt)))
    .run();
}

export interface PendingInvite {
  token: string;
  role: UserRole;
  courseTitle: string | null;
  expiresAt: number;
  createdByName: string | null;
}

/** Invites that can still be used, newest first, for the operator's view. */
export function listPendingInvites(): PendingInvite[] {
  return db
    .select({
      token: invites.id,
      role: invites.role,
      expiresAt: invites.expiresAt,
      title: courses.title,
      createdByName: users.name,
    })
    .from(invites)
    .leftJoin(courses, eq(courses.id, invites.courseId))
    .leftJoin(users, eq(users.id, invites.createdBy))
    .where(and(isNull(invites.usedAt), isNull(invites.revokedAt)))
    .orderBy(desc(invites.createdAt))
    .all()
    .filter((r) => r.expiresAt > now())
    .map((r) => ({
      token: r.token,
      role: r.role,
      courseTitle: r.title ?? null,
      expiresAt: r.expiresAt,
      createdByName: r.createdByName ?? null,
    }));
}

/** This student's finish-by for a course (epoch ms), or null. */
export function studentDeadline(courseId: string, userId: string): number | null {
  const row = db
    .select({ deadline: enrollments.deadline })
    .from(enrollments)
    .where(
      and(eq(enrollments.courseId, courseId), eq(enrollments.userId, userId)),
    )
    .get();
  return row?.deadline ?? null;
}
