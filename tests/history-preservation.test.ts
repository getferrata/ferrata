import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-hist-")),
  "test.db",
);

const { db } = await import("@/db");
const {
  concepts,
  courses,
  modules,
  questions,
  reviews,
  users,
  proposals,
} = await import("@/db/schema");
const { newId, now } = await import("@/lib/util/id");
const { getDashboard } = await import("@/lib/course/dashboard");
const { applyProposal } = await import("@/lib/course/proposals");
const { eq } = await import("drizzle-orm");

function seed() {
  const userId = newId("user");
  db.insert(users)
    .values({
      id: userId,
      email: `${userId}@test.dev`,
      name: "Student",
      passwordHash: "x:y",
      role: "student",
    })
    .run();
  const courseId = newId("course");
  db.insert(courses)
    .values({
      id: courseId,
      title: "Edge onboarding",
      sourcePrompt: "onboard the on-call engineer",
      lang: "en",
      status: "ready",
    })
    .run();
  const conceptId = newId("concept");
  db.insert(concepts)
    .values({
      id: conceptId,
      courseId,
      title: "The edge gateway",
      summary: "The single front door.",
      topoOrder: 0,
    })
    .run();
  db.insert(modules)
    .values({
      id: newId("module"),
      conceptId,
      kind: "concept",
      bodyMd: "## Idea\n\nbody",
      status: "ready",
    })
    .run();
  const questionId = newId("q");
  db.insert(questions)
    .values({
      id: questionId,
      conceptId,
      prompt: "What does the gateway terminate?",
      expectedAnswer: "TLS, at the edge.",
      bloomLevel: "remember",
      format: "open",
      misconceptionsJson: "[]",
    })
    .run();
  db.insert(reviews)
    .values({
      id: newId("review"),
      questionId,
      userId,
      answeredAt: now(),
      correct: true,
      confidence: "high",
      gradedBy: "self",
      fsrsStateJson: null,
      questionPrompt: "What does the gateway terminate?",
    })
    .run();
  return { userId, courseId, conceptId, questionId };
}

beforeEach(() => {
  db.delete(reviews).run();
  db.delete(questions).run();
  db.delete(modules).run();
  db.delete(proposals).run();
  db.delete(concepts).run();
  db.delete(courses).run();
  db.delete(users).run();
});

describe("a rewritten module keeps what students already answered", () => {
  it("retires the old questions instead of deleting them", () => {
    const { conceptId, questionId } = seed();

    // What the regeneration job does to the old tests.
    db.update(questions)
      .set({ retiredAt: now() })
      .where(eq(questions.conceptId, conceptId))
      .run();

    // The answer is still on the record: the cascade did not fire.
    const kept = db
      .select()
      .from(reviews)
      .where(eq(reviews.questionId, questionId))
      .all();
    expect(kept).toHaveLength(1);
    expect(kept[0]?.questionPrompt).toBe("What does the gateway terminate?");
  });

  it("a hard delete would have taken the history with it", () => {
    // Pins the reason the retire exists: with foreign keys on, deleting the
    // question cascades into reviews. If this ever stops being true the retire
    // is still correct, but the comment explaining it would be wrong.
    const { questionId } = seed();
    db.delete(questions).where(eq(questions.id, questionId)).run();
    expect(
      db.select().from(reviews).where(eq(reviews.questionId, questionId)).all(),
    ).toHaveLength(0);
  });

  it("keeps a retired question out of the readiness figure", () => {
    const { courseId, conceptId, userId } = seed();
    const before = getDashboard(courseId, new Date(), userId);
    expect(before?.totalQuestions).toBe(1);
    expect(before?.testedCount).toBe(1);

    db.update(questions)
      .set({ retiredAt: now() })
      .where(eq(questions.conceptId, conceptId))
      .run();

    // The retired test no longer counts as something to study, and the answer
    // to it no longer inflates the figure.
    const after = getDashboard(courseId, new Date(), userId);
    expect(after?.totalQuestions).toBe(0);
    expect(after?.testedCount).toBe(0);
  });
});

describe("retiring a concept from an approved proposal", () => {
  it("keeps the answers people already gave", () => {
    const { courseId, conceptId, questionId } = seed();
    const proposalId = newId("prop");
    db.insert(proposals)
      .values({
        id: proposalId,
        courseId,
        kind: "retire_concept",
        conceptId,
        title: "The edge gateway",
        reason: "The new material says the platform team owns it now.",
        payloadJson: null,
      })
      .run();
    const proposal = db
      .select()
      .from(proposals)
      .where(eq(proposals.id, proposalId))
      .get()!;

    const res = applyProposal(proposal, "someone");
    expect(res).toMatchObject({ ok: true, effect: "retired" });

    // The concept is off the route...
    const c = db.select().from(concepts).where(eq(concepts.id, conceptId)).get();
    expect(c?.retiredAt).not.toBeNull();
    // ...and the student's answer is still there.
    expect(
      db.select().from(reviews).where(eq(reviews.questionId, questionId)).all(),
    ).toHaveLength(1);
  });

  it("drops the retired concept out of the dashboard", () => {
    const { courseId, conceptId, userId } = seed();
    db.update(concepts)
      .set({ retiredAt: now() })
      .where(eq(concepts.id, conceptId))
      .run();
    const d = getDashboard(courseId, new Date(), userId);
    expect(d?.concepts).toHaveLength(0);
  });
});
