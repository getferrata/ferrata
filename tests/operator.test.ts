import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-op-")),
  "test.db",
);

const { db } = await import("@/db");
const { courses, users } = await import("@/db/schema");
const { isOperator, mayAdminister } = await import("@/lib/auth/operator");
const { newId } = await import("@/lib/util/id");
const { eq } = await import("drizzle-orm");

function seedUser(
  role: "student" | "examiner",
  operator = false,
): string {
  const id = newId("user");
  db.insert(users)
    .values({
      id,
      email: `${id}@test.dev`,
      name: role,
      passwordHash: "x:y",
      role,
      isOperator: operator,
    })
    .run();
  return id;
}

beforeEach(() => {
  db.delete(courses).run();
  db.delete(users).run();
});

describe("who may act on somebody else's account", () => {
  it("lets the operator administer another author", () => {
    const operator = seedUser("examiner", true);
    const other = seedUser("examiner");
    expect(mayAdminister(operator, other)).toEqual({ ok: true });
  });

  it("stops one author from taking over another", () => {
    // The takeover this closes: B resets A's password, reads the temporary one
    // straight out of the response, and signs in as A. That reaches A's courses
    // and the provider key on the settings page, and invites can mint
    // examiners, so it was one invite away from anybody.
    const b = seedUser("examiner");
    const a = seedUser("examiner");
    const verdict = mayAdminister(b, a);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.status).toBe(403);
  });

  it("still lets any examiner administer a student", () => {
    // Resetting a student's forgotten password is ordinary work, not a
    // privileged act, and requiring the operator for it would make the tool
    // unusable in a team with more than one author.
    const examiner = seedUser("examiner");
    const student = seedUser("student");
    expect(mayAdminister(examiner, student)).toEqual({ ok: true });
  });

  it("reports a missing target as not found rather than forbidden", () => {
    const examiner = seedUser("examiner", true);
    const verdict = mayAdminister(examiner, "user_nope");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.status).toBe(404);
  });

  it("recognises only the account that set the install up", () => {
    const operator = seedUser("examiner", true);
    const other = seedUser("examiner");
    expect(isOperator(operator)).toBe(true);
    expect(isOperator(other)).toBe(false);
  });
});

describe("deleting an author", () => {
  it("moves their courses rather than stranding them", () => {
    // Courses carry an owner id with no foreign key, so the row survives the
    // owner. Left alone it points at somebody who does not exist: no examiner
    // can open, rework, export or delete the course again, while its students
    // carry on studying it. The only remedy was editing the database by hand.
    const operator = seedUser("examiner", true);
    const leaving = seedUser("examiner");
    const courseId = newId("course");
    db.insert(courses)
      .values({
        id: courseId,
        title: "Edge onboarding",
        sourcePrompt: "onboard the on-call engineer",
        lang: "en",
        status: "ready",
        ownerId: leaving,
      })
      .run();

    // What the route does, in one transaction.
    db.transaction((tx) => {
      tx.update(courses)
        .set({ ownerId: operator })
        .where(eq(courses.ownerId, leaving))
        .run();
      tx.delete(users).where(eq(users.id, leaving)).run();
    });

    const row = db.select().from(courses).where(eq(courses.id, courseId)).get();
    expect(row?.ownerId).toBe(operator);
    expect(
      db.select().from(users).where(eq(users.id, leaving)).get(),
    ).toBeUndefined();
  });
});
