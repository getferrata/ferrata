import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-authsess-")),
  "test.db",
);

const { db } = await import("@/db");
const { authSessions, users } = await import("@/db/schema");
const { hashPassword, verifyPassword } = await import("@/lib/auth/password");
const { resetPassword } = await import("@/lib/auth/reset");
const { authenticate } = await import("@/lib/auth/authenticate");
const { newId, now } = await import("@/lib/util/id");

async function seedUser(password = "correct horse battery") {
  const id = newId("user");
  db.insert(users)
    .values({
      id,
      email: `${id}@test.dev`,
      name: "T",
      passwordHash: await hashPassword(password),
      role: "student",
    })
    .run();
  return { id, email: `${id}@test.dev` };
}

function seedSession(userId: string): string {
  const id = newId("sess");
  db.insert(authSessions)
    .values({ id, userId, expiresAt: now() + 60_000 })
    .run();
  return id;
}

const sessionsOf = (userId: string) =>
  db.select().from(authSessions).where(eq(authSessions.userId, userId)).all();

beforeEach(() => {
  db.delete(authSessions).run();
  db.delete(users).run();
});

describe("a password reset takes the account back", () => {
  it("ends every session the account already had", async () => {
    // The reset exists for the case where somebody else got in. If the cookie
    // they hold survives it, the reset changes the password and removes
    // nobody: the intruder stays signed in for the 30 days the cookie lives.
    const victim = await seedUser();
    seedSession(victim.id);
    seedSession(victim.id);
    expect(sessionsOf(victim.id)).toHaveLength(2);

    const temp = await resetPassword(victim.id);

    expect(temp).toBeTruthy();
    expect(sessionsOf(victim.id)).toHaveLength(0);
  });

  it("leaves other people's sessions alone", async () => {
    const victim = await seedUser();
    const bystander = await seedUser();
    seedSession(victim.id);
    seedSession(bystander.id);

    await resetPassword(victim.id);

    expect(sessionsOf(bystander.id)).toHaveLength(1);
  });

  it("the new temporary password works and the old one does not", async () => {
    const victim = await seedUser("old password!");
    const temp = (await resetPassword(victim.id))!;
    expect(await authenticate(victim.email, temp)).not.toBeNull();
    expect(await authenticate(victim.email, "old password!")).toBeNull();
  });

  it("refuses a sign-in whose password was replaced while it was being checked", async () => {
    // authenticate reads the hash, then spends ~100ms verifying. A reset that
    // lands in that window used to be ignored: the old password still
    // validated against the old hash and a fresh session was created after the
    // reset had already cleared them all.
    const victim = await seedUser("old password!");
    // Hashed first: awaiting it after the attempt starts would let the attempt
    // finish before the reset, and the test would pass or fail by timing.
    const replacement = await hashPassword("new password!");
    const attempt = authenticate(victim.email, "old password!");
    db.update(users)
      .set({ passwordHash: replacement })
      .where(eq(users.id, victim.id))
      .run();
    expect(await attempt).toBeNull();
  });

  it("answers null for a user who does not exist", async () => {
    expect(await resetPassword("user_nobody")).toBeNull();
  });
});

describe("signing in does not reveal which emails have an account", () => {
  it("takes comparable time for an unknown email and a wrong password", async () => {
    // A hash costs ~100ms and a lookup that finds nothing costs microseconds.
    // If the unknown-email path skips the hash, "how long did the refusal take"
    // answers "is this person a user here", with no guessing and no throttle
    // tripped. Compared as a ratio, not against a number, so a slow CI machine
    // moves both sides together.
    const known = await seedUser();
    await verifyPassword("warm-up", await hashPassword("warm-up"));

    const timeIt = async (email: string) => {
      const t = performance.now();
      await authenticate(email, "wrong password");
      return performance.now() - t;
    };
    const knownMs: number[] = [];
    const unknownMs: number[] = [];
    for (let i = 0; i < 3; i++) {
      knownMs.push(await timeIt(known.email));
      unknownMs.push(await timeIt(`nobody${i}@test.dev`));
    }
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[1]!;
    expect(median(unknownMs)).toBeGreaterThan(median(knownMs) * 0.5);
    // Seven scrypt runs at production cost: slow by construction.
  }, 60_000);

  it("still refuses an unknown email", async () => {
    expect(await authenticate("nobody@test.dev", "whatever")).toBeNull();
  });
});
