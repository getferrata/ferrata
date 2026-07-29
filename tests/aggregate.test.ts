import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-agg-")),
  "test.db",
);

const { db } = await import("@/db");
const {
  concepts,
  courses,
  enrollments,
  questions,
  reviews,
  users,
} = await import("@/db/schema");
const { newId, now } = await import("@/lib/util/id");
const { getCourseAggregate } = await import("@/lib/course/aggregate");
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
});
