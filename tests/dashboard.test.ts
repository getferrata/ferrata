import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the app at a throwaway DB before anything imports "@/db".
process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-dash-")),
  "test.db",
);

const { db } = await import("@/db");
const { courses, concepts, explanations, modules, questions, reviews } =
  await import("@/db/schema");
const { getDashboard } = await import("@/lib/course/dashboard");
const { newId, now } = await import("@/lib/util/id");
const { review, knowledgeHeld } = await import("@/lib/fsrs");
const { eq: eqDrizzle } = await import("drizzle-orm");

function seedCourse() {
  const courseId = newId("course");
  db.insert(courses)
    .values({
      id: courseId,
      title: "Edge onboarding",
      sourcePrompt: "onboard the on-call engineer",
      lang: "en",
      status: "ready",
      createdAt: now(),
    })
    .run();
  const mk = (title: string) => {
    const id = newId("concept");
    db.insert(concepts)
      .values({
        id,
        courseId,
        title,
        summary: "s",
        depthLevel: 1,
      })
      .run();
    db.insert(modules)
      .values({
        id: newId("module"),
        conceptId: id,
        kind: "concept",
        bodyMd: "body",
        status: "ready",
        generatedAt: now(),
      })
      .run();
    db.insert(questions)
      .values({
        id: newId("q"),
        conceptId: id,
        prompt: "why?",
        expectedAnswer: "because",
        bloomLevel: "understand",
        format: "open",
        misconceptionsJson: "[]",
      })
      .run();
    return id;
  };
  return { courseId, a: mk("Gateway"), b: mk("Failover"), c: mk("Stores") };
}

/** Every question belonging to a concept, in insertion order. */
function questionsOf(conceptId: string): string[] {
  return db
    .select({ id: questions.id })
    .from(questions)
    .where(eqDrizzle(questions.conceptId, conceptId))
    .all()
    .map((q) => q.id);
}

/** Answer a question, storing a real FSRS card, as the app does. */
function answer(
  questionId: string,
  correct: boolean,
  confidence: "low" | "medium" | "high" = "high",
  at = new Date(),
) {
  const { next } = review(null, correct, confidence, at);
  db.insert(reviews)
    .values({
      id: newId("rev"),
      questionId,
      answeredAt: at.getTime(),
      correct,
      confidence,
      fsrsStateJson: JSON.stringify(next),
    })
    .run();
}

function answerCorrectly(questionId: string, at = new Date()) {
  answer(questionId, true, "high", at);
}

describe("getDashboard explain-back evidence", () => {
  it("reports the latest explanation verdict per concept and counts clean ones", () => {
    const { courseId, a, b } = seedCourse();
    // Concept a: first gappy, then complete. Latest wins.
    db.insert(explanations)
      .values({
        id: newId("expl"),
        conceptId: a,
        userId: null,
        complete: false,
        gap: "missed VRRP",
        createdAt: 100,
      })
      .run();
    db.insert(explanations)
      .values({
        id: newId("expl"),
        conceptId: a,
        userId: null,
        complete: true,
        gap: "",
        createdAt: 200,
      })
      .run();
    // Concept b: one gappy attempt.
    db.insert(explanations)
      .values({
        id: newId("expl"),
        conceptId: b,
        userId: null,
        complete: false,
        gap: "no failover timing",
        createdAt: 150,
      })
      .run();

    const d = getDashboard(courseId);
    expect(d).not.toBeNull();
    const byTitle = new Map(d!.concepts.map((c) => [c.title, c.explained]));
    expect(byTitle.get("Gateway")).toBe("complete");
    expect(byTitle.get("Failover")).toBe("gappy");
    expect(byTitle.get("Stores")).toBeNull();
    expect(d!.explainedCount).toBe(1);
  });

  it("scopes explanations to the requested student", () => {
    const { courseId, a } = seedCourse();
    db.insert(explanations)
      .values({
        id: newId("expl"),
        conceptId: a,
        userId: "user_other",
        complete: true,
        gap: "",
        createdAt: 100,
      })
      .run();
    const d = getDashboard(courseId, new Date(), "user_me");
    expect(d!.explainedCount).toBe(0);
    const other = getDashboard(courseId, new Date(), "user_other");
    expect(other!.explainedCount).toBe(1);
  });
});

describe("readiness counts what has never been tested", () => {
  it("does not read as fully ready after one correct answer out of three", () => {
    // The bug this replaces: the mean ran over tested concepts only, so a
    // single correct answer showed 100% on the one number the product
    // promises is honest. Denis saw "100%" next to "4/104 tested".
    const { courseId, a } = seedCourse();
    answerCorrectly(questionsOf(a)[0]!);
    const d = getDashboard(courseId, new Date());
    expect(d!.courseRetention).not.toBeNull();
    expect(d!.courseRetention!).toBeLessThan(0.5);
  });

  it("says nothing at all while nothing has been tested", () => {
    const { courseId } = seedCourse();
    expect(getDashboard(courseId, new Date())!.courseRetention).toBeNull();
  });

  it("rises as more of the course is actually answered", () => {
    const { courseId, a, b, c } = seedCourse();
    answerCorrectly(questionsOf(a)[0]!);
    const little = getDashboard(courseId, new Date())!.courseRetention!;
    answerCorrectly(questionsOf(b)[0]!);
    answerCorrectly(questionsOf(c)[0]!);
    const lots = getDashboard(courseId, new Date())!.courseRetention!;
    expect(lots).toBeGreaterThan(little);
  });

  it("can only approach full readiness when everything has been answered", () => {
    const { courseId, a, b, c } = seedCourse();
    for (const concept of [a, b, c]) answerCorrectly(questionsOf(concept)[0]!);
    expect(getDashboard(courseId, new Date())!.courseRetention!).toBeGreaterThan(
      0.8,
    );
  });
});

describe("a wrong answer is not knowledge", () => {
  it("counts as nothing, however recently it was given", () => {
    // FSRS retrievability is a function of time since the last review, so
    // straight after answering it reads near 1 whether the answer was right or
    // wrong. Right for scheduling the next repetition, wrong for "do they know
    // this now": getting it wrong five minutes ago is the clearest evidence
    // there is that they do not.
    const at = new Date();
    const { next } = review(null, false, "high", at);
    expect(knowledgeHeld(next, false, at)).toBe(0);
  });

  it("still credits a correct answer, and lets it decay", () => {
    const at = new Date();
    const { next } = review(null, true, "high", at);
    expect(knowledgeHeld(next, true, at)).toBeGreaterThan(0.9);
    const later = new Date(at.getTime() + 60 * 24 * 60 * 60 * 1000);
    expect(knowledgeHeld(next, true, later)).toBeLessThan(
      knowledgeHeld(next, true, at),
    );
  });

  it("does not lift a student's readiness when they answer wrongly", () => {
    // Answering confidently and wrongly is what a serious learner does when
    // they believed they knew it. It must not read as progress.
    const { courseId, a, b } = seedCourse();
    answerCorrectly(questionsOf(a)[0]!);
    const before = getDashboard(courseId, new Date())!.courseRetention!;
    answer(questionsOf(b)[0]!, false, "high");
    const after = getDashboard(courseId, new Date())!.courseRetention!;
    expect(after).toBeLessThanOrEqual(before);
  });

  it("shows the confident mistake in the sure-and-wrong list", () => {
    const { courseId, a } = seedCourse();
    answer(questionsOf(a)[0]!, false, "high");
    const d = getDashboard(courseId, new Date())!;
    expect(d.sureWrong).toHaveLength(1);
    expect(d.courseRetention).toBe(0);
  });
});
