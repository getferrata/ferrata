import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-weak-")),
  "test.db",
);

const { db } = await import("@/db");
const { concepts, courses, questions, reviews, users } = await import(
  "@/db/schema"
);
const { newId, now } = await import("@/lib/util/id");
const { failedQuestionsByConcept, failedQuestionsForConcept, rewriteNotesFromFailures } =
  await import("@/lib/course/weakness");

let courseId = "";

function seedCourse(mode: "practice" | "assessed" = "practice"): void {
  courseId = newId("course");
  db.insert(courses)
    .values({
      id: courseId,
      title: "Edge onboarding",
      sourcePrompt: "onboard the on-call engineer",
      lang: "en",
      status: "ready",
      assessmentMode: mode,
    })
    .run();
}

function seedConcept(title: string): string {
  const id = newId("concept");
  db.insert(concepts)
    .values({ id, courseId, title, summary: "s", topoOrder: 0 })
    .run();
  return id;
}

function seedQuestion(
  conceptId: string,
  prompt: string,
  expectedAnswer = "The backend pool is empty.",
  retired = false,
): string {
  const id = newId("q");
  db.insert(questions)
    .values({
      id,
      conceptId,
      prompt,
      expectedAnswer,
      bloomLevel: "remember",
      format: "open",
      misconceptionsJson: "[]",
      retiredAt: retired ? now() : null,
    })
    .run();
  return id;
}

function seedStudent(name: string): string {
  const id = newId("user");
  db.insert(users)
    .values({
      id,
      email: `${id}@test.dev`,
      name,
      passwordHash: "x:y",
      role: "student",
    })
    .run();
  return id;
}

function answer(
  questionId: string,
  userId: string,
  correct: boolean,
  opts: { at?: number; gradedBy?: "self" | "system" | "model" } = {},
): void {
  db.insert(reviews)
    .values({
      id: newId("review"),
      questionId,
      userId,
      answeredAt: opts.at ?? now(),
      correct,
      confidence: "high",
      gradedBy: opts.gradedBy ?? "system",
    })
    .run();
}

beforeEach(() => {
  db.delete(reviews).run();
  db.delete(questions).run();
  db.delete(concepts).run();
  db.delete(courses).run();
  db.delete(users).run();
  seedCourse();
});

describe("what the class got wrong in a concept", () => {
  it("keeps a question more readers fail than pass", () => {
    const c = seedConcept("Reading a 503");
    const q = seedQuestion(c, "What does a 503 at the edge mean?");
    answer(q, seedStudent("Anna"), false);
    answer(q, seedStudent("Marco"), false);
    answer(q, seedStudent("Luca"), true);

    const [failed, ...rest] = failedQuestionsForConcept(courseId, c);
    expect(rest).toEqual([]);
    expect(failed).toMatchObject({
      prompt: "What does a 503 at the edge mean?",
      wrong: 2,
      answered: 3,
    });
  });

  it("drops a question most readers get right", () => {
    // Two of three passing is not evidence about the module. Rewriting against
    // it would spend money to fix a question that works.
    const c = seedConcept("The edge gateway");
    const q = seedQuestion(c, "What terminates TLS?");
    answer(q, seedStudent("Anna"), true);
    answer(q, seedStudent("Marco"), true);
    answer(q, seedStudent("Luca"), false);

    expect(failedQuestionsForConcept(courseId, c)).toEqual([]);
  });

  it("drops a question split exactly down the middle", () => {
    // Half wrong is the boundary, and it is deliberately exclusive: a coin
    // flip is not proof the module fails people.
    const c = seedConcept("Failover");
    const q = seedQuestion(c, "What moves the VIP?");
    answer(q, seedStudent("Anna"), false);
    answer(q, seedStudent("Marco"), true);

    expect(failedQuestionsForConcept(courseId, c)).toEqual([]);
  });

  it("counts the latest answer per student, not every attempt", () => {
    // Somebody who got it wrong twice and then right is somebody who learned.
    // Counting attempts would make the module look broken by the very readers
    // it taught.
    const c = seedConcept("Reading a 503");
    const q = seedQuestion(c, "What does a 503 mean?");
    const anna = seedStudent("Anna");
    answer(q, anna, false, { at: now() - 3000 });
    answer(q, anna, false, { at: now() - 2000 });
    answer(q, anna, true, { at: now() - 1000 });

    expect(failedQuestionsForConcept(courseId, c)).toEqual([]);
  });

  it("counts one student once, however many times they answered", () => {
    const c = seedConcept("Reading a 503");
    const q = seedQuestion(c, "What does a 503 mean?");
    const anna = seedStudent("Anna");
    answer(q, anna, false, { at: now() - 2000 });
    answer(q, anna, false, { at: now() - 1000 });

    const [failed] = failedQuestionsForConcept(courseId, c);
    expect(failed).toMatchObject({ wrong: 1, answered: 1 });
  });

  it("ignores questions retired by an earlier rewrite", () => {
    // Their reviews stay in the ledger on purpose. Rewriting against wording
    // no reader can see any more would repair a module that no longer exists.
    const c = seedConcept("Reading a 503");
    const old = seedQuestion(c, "Old wording", "yes", true);
    answer(old, seedStudent("Anna"), false);
    answer(old, seedStudent("Marco"), false);

    expect(failedQuestionsForConcept(courseId, c)).toEqual([]);
  });

  it("says nothing about a concept nobody has answered", () => {
    const c = seedConcept("Rate limiting");
    seedQuestion(c, "When does the limiter shed load?");
    expect(failedQuestionsForConcept(courseId, c)).toEqual([]);
  });

  it("orders the worst first and stops at the limit", () => {
    const c = seedConcept("Reading a 503");
    const students = ["Anna", "Marco", "Luca", "Sara"].map(seedStudent);
    // Three failing questions, failed by 4, 3 and 2 readers.
    const q4 = seedQuestion(c, "Worst");
    const q3 = seedQuestion(c, "Middle");
    const q2 = seedQuestion(c, "Least bad");
    for (const s of students) answer(q4, s, false);
    students.forEach((s, i) => answer(q3, s, i >= 3));
    students.forEach((s, i) => answer(q2, s, i >= 2));

    expect(
      failedQuestionsForConcept(courseId, c).map((f) => f.prompt),
    ).toEqual(["Worst", "Middle"]);

    expect(failedQuestionsForConcept(courseId, c, 1)).toHaveLength(1);
  });
});

describe("which answers count as evidence", () => {
  it("ignores self-graded answers in an assessed course", () => {
    // The same rule the readiness figures use. A student's opinion of their own
    // answer is not evidence about the module, and a course that says it only
    // measures machine-checked answers cannot quietly rewrite modules on the
    // strength of them.
    seedCourse("assessed");
    const c = seedConcept("Reading a 503");
    const q = seedQuestion(c, "What does a 503 mean?");
    answer(q, seedStudent("Anna"), false, { gradedBy: "self" });
    answer(q, seedStudent("Marco"), false, { gradedBy: "self" });

    expect(failedQuestionsForConcept(courseId, c)).toEqual([]);
  });

  it("counts a model-graded explain-back in an assessed course", () => {
    seedCourse("assessed");
    const c = seedConcept("Reading a 503");
    const q = seedQuestion(c, "What does a 503 mean?");
    answer(q, seedStudent("Anna"), false, { gradedBy: "model" });
    answer(q, seedStudent("Marco"), false, { gradedBy: "system" });

    expect(failedQuestionsForConcept(courseId, c)).toHaveLength(1);
  });

  it("counts self-graded answers in a practice course", () => {
    // Practice is what the mode is for: the reader is the grader, and their
    // saying they got it wrong is the only signal there is.
    const c = seedConcept("Reading a 503");
    const q = seedQuestion(c, "What does a 503 mean?");
    answer(q, seedStudent("Anna"), false, { gradedBy: "self" });
    answer(q, seedStudent("Marco"), false, { gradedBy: "self" });

    expect(failedQuestionsForConcept(courseId, c)).toHaveLength(1);
  });
});

describe("asking about several concepts at once", () => {
  it("answers for each of them in one pass", () => {
    const a = seedConcept("Reading a 503");
    const b = seedConcept("Failover");
    const qa = seedQuestion(a, "What does a 503 mean?");
    const qb = seedQuestion(b, "What moves the VIP?");
    const anna = seedStudent("Anna");
    const marco = seedStudent("Marco");
    answer(qa, anna, false);
    answer(qa, marco, false);
    answer(qb, anna, false);
    answer(qb, marco, false);

    const map = failedQuestionsByConcept(courseId, [a, b]);
    expect(map.get(a)).toHaveLength(1);
    expect(map.get(b)).toHaveLength(1);
  });

  it("leaves out a concept with nothing to report", () => {
    // Absent rather than present-and-empty, so a caller cannot read "no
    // failures" as "no data" or the other way round.
    const a = seedConcept("Reading a 503");
    const b = seedConcept("Failover");
    const qa = seedQuestion(a, "What does a 503 mean?");
    seedQuestion(b, "What moves the VIP?");
    answer(qa, seedStudent("Anna"), false);
    answer(qa, seedStudent("Marco"), false);

    const map = failedQuestionsByConcept(courseId, [a, b]);
    expect(map.has(a)).toBe(true);
    expect(map.has(b)).toBe(false);
  });

  it("applies the limit per concept, not across the batch", () => {
    const a = seedConcept("Reading a 503");
    const b = seedConcept("Failover");
    const students = ["Anna", "Marco"].map(seedStudent);
    for (const c of [a, b]) {
      for (const label of ["one", "two"]) {
        const q = seedQuestion(c, `${c} ${label}`);
        for (const s of students) answer(q, s, false);
      }
    }

    const map = failedQuestionsByConcept(courseId, [a, b], 1);
    expect(map.get(a)).toHaveLength(1);
    expect(map.get(b)).toHaveLength(1);
  });

  it("returns nothing for an empty list or a course that does not exist", () => {
    expect(failedQuestionsByConcept(courseId, []).size).toBe(0);
    expect(failedQuestionsByConcept("course_nope", ["concept_nope"]).size).toBe(
      0,
    );
  });
});

describe("turning failures into a brief for the writer", () => {
  it("carries the question, the answer and how many missed it", () => {
    const [note] = rewriteNotesFromFailures([
      {
        prompt: "What does a 503 at the edge mean?",
        expectedAnswer: "The backend pool is empty.",
        wrong: 3,
        answered: 4,
      },
    ]);
    expect(note).toContain("What does a 503 at the edge mean?");
    expect(note).toContain("The backend pool is empty.");
    expect(note).toContain("3 of 4");
  });

  it("blames the module, not the reader", () => {
    // The module is the thing being rewritten. A brief that says the readers
    // failed produces a module that lectures them.
    const [note] = rewriteNotesFromFailures([
      {
        prompt: "q",
        expectedAnswer: "a",
        wrong: 2,
        answered: 2,
      },
    ]);
    expect(note).toContain("the module does not teach it clearly enough");
  });

  it("produces nothing at all when nothing failed", () => {
    expect(rewriteNotesFromFailures([])).toEqual([]);
  });
});
