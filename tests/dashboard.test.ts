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
  gradedBy: "self" | "system" | "model" = "self",
) {
  const { next } = review(null, correct, confidence, at);
  db.insert(reviews)
    .values({
      id: newId("rev"),
      questionId,
      answeredAt: at.getTime(),
      correct,
      confidence,
      gradedBy,
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

describe("where the readiness figure came from", () => {
  it("says so when every answer was graded by the student", () => {
    const { courseId, a } = seedCourse();
    answer(questionsOf(a)[0]!, true);
    expect(getDashboard(courseId)!.evidence).toEqual({
      self: 1,
      system: 0,
      model: 0,
    });
  });

  it("counts the ones the system settled separately", () => {
    const { courseId, a, b, c } = seedCourse();
    answer(questionsOf(a)[0]!, true, "high", new Date(), "system");
    answer(questionsOf(b)[0]!, false, "high", new Date(), "system");
    answer(questionsOf(c)[0]!, true, "high", new Date(), "self");
    expect(getDashboard(courseId)!.evidence).toEqual({
      self: 1,
      system: 2,
      model: 0,
    });
  });

  it("counts only the latest answer per question", () => {
    // Somebody who self-graded, then answered the same question again as a
    // multiple choice, is one piece of evidence and not two.
    const { courseId, a } = seedCourse();
    const q = questionsOf(a)[0]!;
    answer(q, true, "high", new Date(1_000_000), "self");
    answer(q, false, "high", new Date(2_000_000), "system");
    expect(getDashboard(courseId)!.evidence).toEqual({
      self: 0,
      system: 1,
      model: 0,
    });
  });
});

const { randomUUID } = await import("node:crypto");
const { getRoster } = await import("@/lib/course/roster");
const { users, enrollments } = await import("@/db/schema");

describe("assessed mode: the figure is a measurement, not a diary", () => {
  function seedAssessed() {
    const courseId = newId("course");
    db.insert(courses)
      .values({
        id: courseId,
        title: "Assessed onboarding",
        sourcePrompt: "p",
        lang: "en",
        status: "ready",
        assessmentMode: "assessed",
        createdAt: now(),
      })
      .run();
    const conceptId = newId("concept");
    db.insert(concepts)
      .values({ id: conceptId, courseId, title: "Gateway", summary: "s", depthLevel: 1 })
      .run();
    const mcq = newId("q");
    db.insert(questions)
      .values({
        id: mcq,
        conceptId,
        prompt: "which one?",
        expectedAnswer: "b",
        bloomLevel: "remember",
        format: "mcq",
        optionsJson: JSON.stringify({ options: ["a", "b"], correctIndex: 1 }),
        misconceptionsJson: "[]",
      })
      .run();
    const open = newId("q");
    db.insert(questions)
      .values({
        id: open,
        conceptId,
        prompt: "why?",
        expectedAnswer: "because",
        bloomLevel: "understand",
        format: "open",
        misconceptionsJson: "[]",
      })
      .run();
    return { courseId, conceptId, mcq, open };
  }

  it("counts only the questions the system can check", () => {
    const { courseId } = seedAssessed();
    const d = getDashboard(courseId)!;
    expect(d.assessmentMode).toBe("assessed");
    expect(d.totalQuestions).toBe(1);
    expect(d.practiceQuestions).toBe(1);
  });

  it("ignores a self-graded answer even on a checkable question", () => {
    // The student pressed "I had it" on the open question AND somehow recorded
    // a self verdict on the mcq. Neither can testify in assessed mode.
    const { courseId, mcq, open } = seedAssessed();
    answer(mcq, true, "high", new Date(), "self");
    answer(open, true, "high", new Date(), "self");
    const d = getDashboard(courseId)!;
    expect(d.testedCount).toBe(0);
    expect(d.courseRetention).toBeNull();
  });

  it("counts a machine-checked answer", () => {
    const { courseId, mcq } = seedAssessed();
    answer(mcq, true, "high", new Date(), "system");
    const d = getDashboard(courseId)!;
    expect(d.testedCount).toBe(1);
    expect(d.evidence).toEqual({ self: 0, system: 1, model: 0 });
    expect(d.courseRetention).toBeGreaterThan(0.8);
  });

  it("drops a concept with nothing checkable from the denominator", () => {
    // Otherwise "the mode cannot measure this" reads as "the student does not
    // know this" and the figure can never reach the top.
    const { courseId, mcq } = seedAssessed();
    const bare = newId("concept");
    db.insert(concepts)
      .values({ id: bare, courseId, title: "Anecdotes", summary: "s", depthLevel: 1 })
      .run();
    db.insert(questions)
      .values({
        id: newId("q"),
        conceptId: bare,
        prompt: "story?",
        expectedAnswer: "long",
        bloomLevel: "understand",
        format: "open",
        misconceptionsJson: "[]",
      })
      .run();
    answer(mcq, true, "high", new Date(), "system");
    const d = getDashboard(courseId)!;
    expect(d.courseRetention).toBeGreaterThan(0.8);
  });

  it("holds the roster to the same rule as the student's own view", () => {
    const { courseId, mcq, open } = seedAssessed();
    const uid = randomUUID();
    db.insert(users)
      .values({ id: uid, email: `${uid}@x`, name: "S", passwordHash: "x", role: "student" })
      .run();
    db.insert(enrollments)
      .values({ id: newId("enr"), courseId, userId: uid, createdAt: now() })
      .run();

    // Self-grades everything, machine-checks nothing: roster shows nothing held.
    const selfCard = review(null, true, "high").next;
    for (const q of [mcq, open]) {
      db.insert(reviews)
        .values({
          id: newId("rev"),
          questionId: q,
          userId: uid,
          answeredAt: now(),
          correct: true,
          confidence: "high",
          gradedBy: "self",
          fsrsStateJson: JSON.stringify(selfCard),
        })
        .run();
    }
    const before = getRoster(courseId).find((r) => r.userId === uid)!;
    expect(before.total).toBe(1);
    expect(before.answered).toBe(0);
    expect(before.retention).toBeNull();

    // One machine-checked answer moves the number.
    db.insert(reviews)
      .values({
        id: newId("rev"),
        questionId: mcq,
        userId: uid,
        answeredAt: now() + 1,
        correct: true,
        confidence: "high",
        gradedBy: "system",
        fsrsStateJson: JSON.stringify(review(null, true, "high").next),
      })
      .run();
    const after = getRoster(courseId).find((r) => r.userId === uid)!;
    expect(after.answered).toBe(1);
    expect(after.retention).toBeGreaterThan(0.8);
  });
});

describe("the dashboard and the roster tell the same student the same number", () => {
  it("agree on a concept with one of two questions answered", () => {
    // The bug: the dashboard averaged a concept over its ANSWERED questions
    // (so 1/2 correct read as ~100% for that concept), while the roster divided
    // by all of them (~50%). Same evidence, two numbers.
    const courseId = newId("course");
    db.insert(courses)
      .values({
        id: courseId,
        title: "Parity",
        sourcePrompt: "p",
        lang: "en",
        status: "ready",
        createdAt: now(),
      })
      .run();
    const conceptId = newId("concept");
    db.insert(concepts)
      .values({ id: conceptId, courseId, title: "Gateway", summary: "s", depthLevel: 1 })
      .run();
    const answered = newId("q");
    const untested = newId("q");
    for (const id of [answered, untested]) {
      db.insert(questions)
        .values({
          id,
          conceptId,
          prompt: "why?",
          expectedAnswer: "because",
          bloomLevel: "understand",
          format: "open",
          misconceptionsJson: "[]",
        })
        .run();
    }
    const uid = randomUUID();
    db.insert(users)
      .values({ id: uid, email: `${uid}@x`, name: "S", passwordHash: "x", role: "student" })
      .run();
    db.insert(enrollments)
      .values({ id: newId("enr"), courseId, userId: uid, createdAt: now() })
      .run();
    db.insert(reviews)
      .values({
        id: newId("rev"),
        questionId: answered,
        userId: uid,
        answeredAt: now(),
        correct: true,
        confidence: "high",
        gradedBy: "self",
        fsrsStateJson: JSON.stringify(review(null, true, "high").next),
      })
      .run();

    const dash = getDashboard(courseId, new Date(), uid)!;
    const roster = getRoster(courseId).find((r) => r.userId === uid)!;
    // One of two known, so about a half, not a whole. And identical either way.
    expect(dash.courseRetention).toBeLessThan(0.7);
    expect(dash.courseRetention).toBeCloseTo(roster.retention!, 5);
  });
});
