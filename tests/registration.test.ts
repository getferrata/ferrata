import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-reg-")),
  "test.db",
);

const { db } = await import("@/db");
const { courses, enrollments, invites, users } = await import("@/db/schema");
const { checkRegistration } = await import("@/lib/auth/registration");
const {
  createInvite,
  readInvite,
  consumeInvite,
  enrollByInvite,
  revokeInvite,
  listPendingInvites,
  INVITE_TTL_MS,
} = await import("@/lib/course/invite");
const { newId, now } = await import("@/lib/util/id");

function seedUser(role: "student" | "examiner" = "examiner"): string {
  const id = newId("user");
  db.insert(users)
    .values({
      id,
      email: `${id}@test.dev`,
      name: "Test",
      passwordHash: "x:y",
      role,
    })
    .run();
  return id;
}

function seedCourse(ownerId: string): string {
  const id = newId("course");
  db.insert(courses)
    .values({
      id,
      title: "Edge onboarding",
      sourcePrompt: "onboard the on-call engineer",
      lang: "en",
      status: "ready",
      ownerId,
    })
    .run();
  return id;
}

beforeEach(() => {
  db.delete(enrollments).run();
  db.delete(invites).run();
  db.delete(courses).run();
  db.delete(users).run();
  delete process.env.FERRATA_OPEN_REGISTRATION;
});

afterEach(() => {
  delete process.env.FERRATA_OPEN_REGISTRATION;
});

describe("who may register", () => {
  it("lets the very first account in, as the examiner", () => {
    const verdict = checkRegistration();
    expect(verdict).toMatchObject({ ok: true, role: "examiner" });
  });

  it("turns away a stranger once an account exists", () => {
    seedUser();
    const verdict = checkRegistration();
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.status).toBe(403);
      expect(verdict.error).toMatch(/invite only/i);
    }
  });

  it("takes the role from the invite, not from the person arriving", () => {
    const admin = seedUser();
    const token = createInvite({ role: "examiner", createdBy: admin });
    expect(checkRegistration(token)).toMatchObject({
      ok: true,
      role: "examiner",
      inviteToken: token,
    });

    const studentToken = createInvite({ role: "student", createdBy: admin });
    expect(checkRegistration(studentToken)).toMatchObject({
      ok: true,
      role: "student",
    });
  });

  it("reopens when the operator asks for an open install", () => {
    seedUser();
    process.env.FERRATA_OPEN_REGISTRATION = "1";
    expect(checkRegistration()).toMatchObject({ ok: true, role: "student" });
  });

  it("never hands out examiner through open registration", () => {
    seedUser();
    process.env.FERRATA_OPEN_REGISTRATION = "1";
    const verdict = checkRegistration();
    expect(verdict.ok && verdict.role).toBe("student");
  });
});

describe("invite lifetime", () => {
  it("refuses an unknown token", () => {
    expect(readInvite("inv_nope")).toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses one that has expired, and says so", () => {
    const admin = seedUser();
    const token = createInvite({ createdBy: admin, ttlMs: -1 });
    expect(readInvite(token)).toEqual({ ok: false, reason: "expired" });
    const verdict = checkRegistration(token);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toMatch(/expired/i);
  });

  it("defaults to three days", () => {
    const admin = seedUser();
    const token = createInvite({ createdBy: admin });
    const check = readInvite(token);
    expect(check.ok).toBe(true);
    if (check.ok) {
      const life = check.invite.expiresAt - now();
      expect(life).toBeGreaterThan(INVITE_TTL_MS - 5_000);
      expect(life).toBeLessThanOrEqual(INVITE_TTL_MS);
    }
  });

  it("burns on use, so a forwarded link is worth nothing to the next person", () => {
    const admin = seedUser();
    const token = createInvite({ createdBy: admin });
    const first = seedUser("student");
    expect(consumeInvite(token, first)).toBeNull(); // no course on this invite
    expect(readInvite(token)).toEqual({ ok: false, reason: "used" });

    const second = seedUser("student");
    expect(consumeInvite(token, second)).toBeNull();
    expect(checkRegistration(token).ok).toBe(false);
  });

  it("lets only one of two racing registrations claim it", () => {
    const admin = seedUser();
    const courseId = seedCourse(admin);
    const token = createInvite({ courseId, createdBy: admin });
    const a = seedUser("student");
    const b = seedUser("student");

    expect(consumeInvite(token, a)).toBe(courseId);
    expect(consumeInvite(token, b)).toBeNull();

    const enrolled = db.select().from(enrollments).all();
    expect(enrolled).toHaveLength(1);
    expect(enrolled[0]?.userId).toBe(a);
  });

  it("can be revoked before anyone uses it", () => {
    const admin = seedUser();
    const token = createInvite({ createdBy: admin });
    revokeInvite(token);
    expect(readInvite(token)).toEqual({ ok: false, reason: "revoked" });
  });

  it("enrolls an existing account without burning the link", () => {
    // The invite was meant for someone who has not signed up yet; a colleague
    // opening it must not consume their only way in.
    const admin = seedUser();
    const courseId = seedCourse(admin);
    const token = createInvite({ courseId, createdBy: admin });
    const existing = seedUser("student");

    expect(enrollByInvite(token, existing)).toBe(courseId);
    expect(readInvite(token).ok).toBe(true);
  });

  it("is idempotent when the same person opens it twice", () => {
    const admin = seedUser();
    const courseId = seedCourse(admin);
    const token = createInvite({ courseId, createdBy: admin });
    const student = seedUser("student");

    enrollByInvite(token, student);
    enrollByInvite(token, student);
    expect(db.select().from(enrollments).all()).toHaveLength(1);
  });
});

describe("the operator's view of pending invites", () => {
  it("lists what is still usable and drops what is not", () => {
    const admin = seedUser();
    const live = createInvite({ role: "examiner", createdBy: admin });
    const expired = createInvite({ createdBy: admin, ttlMs: -1 });
    const revoked = createInvite({ createdBy: admin });
    revokeInvite(revoked);
    const spent = createInvite({ createdBy: admin });
    consumeInvite(spent, seedUser("student"));

    const pending = listPendingInvites();
    expect(pending.map((p) => p.token)).toEqual([live]);
    expect(pending[0]?.role).toBe("examiner");
    expect(pending).not.toContainEqual(
      expect.objectContaining({ token: expired }),
    );
  });
});
