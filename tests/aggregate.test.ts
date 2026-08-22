import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-agg-")),
  "test.db",
);

const { eq } = await import("drizzle-orm");
const { db } = await import("@/db");
const {
  concepts,
  courses,
  enrollments,
  modules,
  questions,
  reviews,
  users,
} = await import("@/db/schema");
const { newId, now } = await import("@/lib/util/id");
const { getCourseAggregate } = await import("@/lib/course/aggregate");
const { conceptRetentionByStudent, getDashboard } = await import(
  "@/lib/course/dashboard"
);
const { review } = await import("@/lib/fsrs");

let courseId = "";

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
  db.insert(enrollments)
    .values({ id: newId("enr"), courseId, userId: id })
    .run();
  return id;
}

function answer(
  questionId: string,
  userId: string,
  correct: boolean,
  at: number,
): void {
  db.insert(reviews)
    .values({
      id: newId("review"),
      questionId,
      userId,
      answeredAt: at,
      correct,
      confidence: "high",
      gradedBy: "system",
      // Built by the real scheduler rather than hand-written, so the card is
      // whatever the product would actually store for this answer.
      fsrsStateJson: JSON.stringify(review(null, correct, "high").next),
    })
    .run();
}

beforeEach(() => {
  db.delete(reviews).run();
  db.delete(questions).run();
  db.delete(modules).run();
  db.delete(enrollments).run();
  db.delete(concepts).run();
  db.delete(courses).run();
  db.delete(users).run();

  courseId = newId("course");
  db.insert(courses)
    .values({
      id: courseId,
      title: "Edge onboarding",
      sourcePrompt: "onboard the on-call engineer",
      lang: "en",
      status: "ready",
    })
    .run();
});

function seedConceptWithQuestion(title: string): string {
  const conceptId = newId("concept");
  db.insert(concepts)
    .values({ id: conceptId, courseId, title, summary: "s", topoOrder: 0 })
    .run();
  const questionId = newId("q");
  db.insert(questions)
    .values({
      id: questionId,
      conceptId,
      prompt: `${title}?`,
      expectedAnswer: "yes",
      bloomLevel: "remember",
      format: "open",
      misconceptionsJson: "[]",
    })
    .run();
  return questionId;
}

describe("the examiner's view of a course", () => {
  it("reports each student separately instead of one mixed figure", () => {
    const q = seedConceptWithQuestion("The edge gateway");
    const anna = seedStudent("Anna");
    const marco = seedStudent("Marco");

    // Anna is right; Marco answers the same question wrong, later.
    answer(q, anna, true, now() - 1000);
    answer(q, marco, false, now());

    const agg = getCourseAggregate(courseId);
    expect(agg.students).toHaveLength(2);

    const byName = new Map(agg.students.map((s) => [s.name, s]));
    // The old shape kept "the latest answer by anyone", so Marco answering last
    // would have dragged the whole course figure down and Anna's correct answer
    // would have disappeared from it entirely.
    expect(byName.get("Anna")?.retention).toBeGreaterThan(0);
    expect(byName.get("Marco")?.retention).toBe(0);
  });

  it("does not let one person's review move another person's number", () => {
    const q = seedConceptWithQuestion("Reading a 503");
    const anna = seedStudent("Anna");
    const marco = seedStudent("Marco");
    answer(q, anna, true, now() - 5000);

    const before = getCourseAggregate(courseId).students.find(
      (s) => s.name === "Anna",
    )?.retention;

    answer(q, marco, false, now());

    const after = getCourseAggregate(courseId).students.find(
      (s) => s.name === "Anna",
    )?.retention;
    expect(after).toBe(before);
  });

  it("summarises with a median, so an absent student cannot sink the class", () => {
    const q = seedConceptWithQuestion("Failover");
    const anna = seedStudent("Anna");
    const marco = seedStudent("Marco");
    seedStudent("Luca"); // enrolled, never answered
    answer(q, anna, true, now());
    answer(q, marco, true, now());

    const agg = getCourseAggregate(courseId);
    expect(agg.students).toHaveLength(3);
    // Only the two who were measured carry the median; the third is listed but
    // does not count as a zero, because "has not started" is not "does not know".
    expect(agg.measuredStudents).toBe(2);
    expect(agg.medianRetention).toBeGreaterThan(0);
  });

  it("is empty and honest when nobody is enrolled", () => {
    seedConceptWithQuestion("The edge gateway");
    const agg = getCourseAggregate(courseId);
    expect(agg.students).toEqual([]);
    expect(agg.medianRetention).toBeNull();
    expect(agg.measuredStudents).toBe(0);
  });

  it("names a concept most of the class is weak on", () => {
    const q = seedConceptWithQuestion("VRRP");
    const anna = seedStudent("Anna");
    const marco = seedStudent("Marco");
    answer(q, anna, false, now());
    answer(q, marco, false, now());

    const agg = getCourseAggregate(courseId);
    expect(agg.weakForMany.map((w) => w.title)).toContain("VRRP");
    expect(agg.weakForMany[0]?.weakStudents).toBe(2);
  });

  it("carries the module to rewrite and what to rewrite it against", () => {
    // The diagnosis on its own sends an author to rewrite blind. These two
    // fields are what turn the row into an action: which module, and how many
    // questions the writer would actually be handed.
    const q = seedConceptWithQuestion("VRRP");
    const conceptId = db
      .select({ id: questions.conceptId })
      .from(questions)
      .where(eq(questions.id, q))
      .get()!.id;
    const moduleId = newId("module");
    db.insert(modules)
      .values({ id: moduleId, conceptId, bodyMd: "body", status: "ready" })
      .run();
    answer(q, seedStudent("Anna"), false, now());
    answer(q, seedStudent("Marco"), false, now());

    const [weak] = getCourseAggregate(courseId).weakForMany;
    expect(weak).toMatchObject({ moduleId, failedQuestions: 1 });
  });

  it("offers no module for a concept whose module was never written", () => {
    // A build that failed on this concept, or a concept added and not yet
    // written. An action pointing at a module that does not exist would 404 on
    // click, so the page has to be able to tell.
    const q = seedConceptWithQuestion("VRRP");
    answer(q, seedStudent("Anna"), false, now());
    answer(q, seedStudent("Marco"), false, now());

    expect(getCourseAggregate(courseId).weakForMany[0]?.moduleId).toBeNull();
  });

  it("reports no failed questions when the class is weak only by decay", () => {
    // Weak because the spacing model says the answer has faded, with nobody
    // having got a specific question wrong. There is nothing concrete for a
    // rewrite to aim at, and the page must not offer one: it would be a bill,
    // not a fix.
    const q = seedConceptWithQuestion("VRRP");
    // Right, but long enough ago that knowledge held has decayed below weak.
    const longAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000);
    for (const name of ["Anna", "Marco"]) {
      const card = review(null, true, "high").next;
      db.insert(reviews)
        .values({
          id: newId("review"),
          questionId: q,
          userId: seedStudent(name),
          answeredAt: Math.floor(longAgo.getTime() / 1000),
          correct: true,
          confidence: "high",
          gradedBy: "system",
          fsrsStateJson: JSON.stringify({
            ...card,
            last_review: longAgo.toISOString(),
            due: longAgo.toISOString(),
          }),
        })
        .run();
    }

    const [weak] = getCourseAggregate(courseId).weakForMany;
    expect(weak?.weakStudents).toBe(2);
    expect(weak?.failedQuestions).toBe(0);
  });
});

describe("reading the whole roster", () => {
  /** Seed a course of `concepts` x `perConcept` questions answered by `students`. */
  function seedClass(
    conceptCount: number,
    perConcept: number,
    studentCount: number,
  ): { userIds: string[]; questionIds: string[] } {
    const questionIds: string[] = [];
    for (let c = 0; c < conceptCount; c++) {
      const conceptId = newId("concept");
      db.insert(concepts)
        .values({
          id: conceptId,
          courseId,
          title: `Concept ${c}`,
          summary: "s",
          topoOrder: c,
        })
        .run();
      for (let q = 0; q < perConcept; q++) {
        const questionId = newId("q");
        db.insert(questions)
          .values({
            id: questionId,
            conceptId,
            prompt: `c${c} q${q}?`,
            expectedAnswer: "yes",
            bloomLevel: "remember",
            format: "open",
            misconceptionsJson: "[]",
          })
          .run();
        questionIds.push(questionId);
      }
    }
    const userIds: string[] = [];
    for (let s = 0; s < studentCount; s++) {
      const userId = seedStudent(`Student ${s}`);
      userIds.push(userId);
      // Everyone answers everything, later students getting more wrong, so the
      // weak-for-many threshold has something real to cross.
      questionIds.forEach((qid, i) => {
        answer(qid, userId, (i + s) % 3 !== 0, now() - (i + 1) * 10);
      });
    }
    return { userIds, questionIds };
  }

  it("gives every student the same numbers their own dashboard would", () => {
    // The guarantee that matters: this is a read done once instead of once per
    // student, not a different calculation. Compared against the per-student
    // path it replaced, over a class big enough for a mistake to show.
    const { userIds } = seedClass(4, 3, 6);
    const batched = conceptRetentionByStudent(courseId, userIds);

    for (const userId of userIds) {
      const own = getDashboard(courseId, new Date(), userId);
      const mine = batched.get(userId);
      expect(mine).toBeDefined();
      for (const c of own!.concepts) {
        const same = mine!.find((x) => x.conceptId === c.conceptId);
        expect(same, `concept ${c.title} for ${userId}`).toBeDefined();
        expect(same!.retention).toBe(c.retention);
        expect(same!.total).toBe(c.total);
        expect(same!.tested).toBe(c.tested);
      }
    }
  });

  it("costs the same number of queries whatever the class size", () => {
    // The defect was that the page cost grew with the roster. Counting reads is
    // the only assertion that holds that, because a correct answer computed the
    // slow way still looks correct.
    const sqlite = (
      globalThis as unknown as { __ferrataSqlite?: { prepare: unknown } }
    ).__ferrataSqlite;
    expect(sqlite, "raw handle for counting reads").toBeDefined();

    const real = sqlite!.prepare as (sql: string) => unknown;
    let reads = 0;
    const count = (sql: string) => {
      if (/^\s*select/i.test(sql)) reads++;
      return real.call(sqlite, sql);
    };

    const small = seedClass(3, 2, 2);
    (sqlite as { prepare: unknown }).prepare = count;
    reads = 0;
    conceptRetentionByStudent(courseId, small.userIds);
    const forTwo = reads;
    (sqlite as { prepare: unknown }).prepare = real;

    const big = seedClass(3, 2, 20);
    (sqlite as { prepare: unknown }).prepare = count;
    reads = 0;
    conceptRetentionByStudent(courseId, big.userIds);
    const forTwentyTwo = reads;
    (sqlite as { prepare: unknown }).prepare = real;

    expect(forTwo).toBeGreaterThan(0);
    expect(forTwentyTwo).toBe(forTwo);

    // And the shape this replaced, measured the same way, so a pass above means
    // something. Asking each student's dashboard separately reads more as the
    // class grows, which was the whole finding.
    (sqlite as { prepare: unknown }).prepare = count;
    reads = 0;
    for (const userId of small.userIds) getDashboard(courseId, new Date(), userId);
    const oldForTwo = reads;
    reads = 0;
    for (const userId of big.userIds) getDashboard(courseId, new Date(), userId);
    const oldForTwentyTwo = reads;
    (sqlite as { prepare: unknown }).prepare = real;

    expect(oldForTwentyTwo).toBeGreaterThan(oldForTwo * 5);
  });

  it("still counts a concept weak only when half the class is weak on it", () => {
    // The behaviour the batching had to preserve, over a roster large enough
    // that an off-by-one in the threshold would show.
    const { userIds, questionIds } = seedClass(2, 2, 8);
    db.delete(reviews).run();
    // Six of eight get the first concept wrong; two get everything right.
    userIds.forEach((userId, i) => {
      questionIds.forEach((qid, q) => {
        const firstConcept = q < 2;
        answer(qid, userId, !(firstConcept && i < 6), now() - q * 10);
      });
    });

    const agg = getCourseAggregate(courseId);
    expect(agg.measuredStudents).toBe(8);
    expect(agg.weakForMany).toHaveLength(1);
    expect(agg.weakForMany[0]?.weakStudents).toBe(6);
  });
});
