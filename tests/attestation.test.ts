import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  appSettings as settingsT,
  concepts as conceptsT,
  courses as coursesT,
  questions as questionsT,
  reviews as reviewsT,
  users as usersT,
  type AssessmentMode,
} from "@/db/schema";
import {
  ATTESTATION_KEY_SETTING,
  buildAttestation,
  canonicalise,
  verifyAttestation,
} from "@/lib/course/attestation";
import { forgetInstallSecret } from "@/lib/crypto/install-key";
import { newId } from "@/lib/util/id";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

function student(name = "Rosa"): string {
  const id = newId("user");
  db.insert(usersT)
    .values({
      id,
      email: `${id}@example.test`,
      passwordHash: "x",
      role: "student",
      name,
    })
    .run();
  return id;
}

function course(mode: AssessmentMode = "assessed"): string {
  const id = newId("course");
  db.insert(coursesT)
    .values({
      id,
      title: "Edge onboarding",
      sourcePrompt: "brief",
      lang: "en",
      status: "ready",
      assessmentMode: mode,
    })
    .run();
  return id;
}

function concept(courseId: string, title: string): string {
  const id = newId("concept");
  db.insert(conceptsT)
    .values({ id, courseId, title, summary: "s", topoOrder: 0 })
    .run();
  return id;
}

function question(conceptId: string, prompt = "why?"): string {
  const id = newId("q");
  db.insert(questionsT)
    .values({
      id,
      conceptId,
      prompt,
      expectedAnswer: "because",
      bloomLevel: "understand",
      format: "open",
      misconceptionsJson: "[]",
    })
    .run();
  return id;
}

function answer(
  questionId: string,
  userId: string,
  opts: {
    correct?: boolean;
    gradedBy?: "self" | "system" | "model";
    at?: number;
    prompt?: string;
  } = {},
): void {
  db.insert(reviewsT)
    .values({
      id: newId("rev"),
      questionId,
      userId,
      answeredAt: opts.at ?? T0,
      correct: opts.correct ?? true,
      confidence: "high",
      gradedBy: opts.gradedBy ?? "system",
      questionPrompt: opts.prompt ?? "why?",
    })
    .run();
}

beforeEach(() => {
  db.delete(reviewsT).run();
  db.delete(questionsT).run();
  db.delete(conceptsT).run();
  db.delete(coursesT).run();
  db.delete(usersT).run();
  db.delete(settingsT).run();
  forgetInstallSecret();
});

describe("canonical form", () => {
  it("does not depend on the order the object was built in", () => {
    // Without this a refactor that assembles the same values in a different
    // order would invalidate every document ever issued, without changing a
    // single fact in any of them.
    expect(canonicalise({ b: 1, a: 2 })).toBe(canonicalise({ a: 2, b: 1 }));
  });

  it("still tells two different records apart", () => {
    expect(canonicalise({ a: 1 })).not.toBe(canonicalise({ a: 2 }));
    expect(canonicalise({ a: [1, 2] })).not.toBe(canonicalise({ a: [2, 1] }));
  });
});

describe("the record", () => {
  it("counts a concept verified only once every live question is passed", () => {
    const u = student();
    const c = course();
    const k = concept(c, "The edge gateway");
    const q1 = question(k, "one?");
    const q2 = question(k, "two?");

    answer(q1, u, { at: T0 });
    expect(buildAttestation(c, u)!.body.verifiedConcepts).toBe(0);

    answer(q2, u, { at: T0 + DAY });
    const doc = buildAttestation(c, u)!;
    expect(doc.body.verifiedConcepts).toBe(1);
    expect(doc.body.conceptCount).toBe(1);
  });

  it("dates the moment it became true, not the moment it was asked for", () => {
    const u = student();
    const c = course();
    const k = concept(c, "Failover");
    answer(question(k), u, { at: T0 + 5 * DAY });

    const doc = buildAttestation(c, u, T0 + 900 * DAY)!;
    expect(doc.body.timeline).toHaveLength(1);
    expect(doc.body.timeline[0]!.at).toBe(T0 + 5 * DAY);
    expect(doc.body.issuedAt).toBe(T0 + 900 * DAY);
  });

  it("shows the curve, so a reader sees learning and not one final number", () => {
    const u = student();
    const c = course();
    const a = concept(c, "A");
    const b = concept(c, "B");
    answer(question(a), u, { at: T0 });
    answer(question(b), u, { at: T0 + 90 * DAY });

    const doc = buildAttestation(c, u)!;
    expect(doc.body.timeline.map((p) => p.verifiedConcepts)).toEqual([1, 2]);
    expect(doc.body.timeline[0]!.share).toBeCloseTo(0.5, 6);
    expect(doc.body.timeline[1]!.share).toBeCloseTo(1, 6);
  });

  it("refuses self-graded answers as evidence in assessed mode", () => {
    // The whole reason the mode exists. A figure built from somebody marking
    // their own paper attests to honesty, not to knowledge.
    const u = student();
    const c = course("assessed");
    const k = concept(c, "Rate limiting");
    answer(question(k), u, { gradedBy: "self" });

    const doc = buildAttestation(c, u)!;
    expect(doc.body.verifiedConcepts).toBe(0);
    expect(doc.body.trail).toHaveLength(0);
  });

  it("keeps a practice course's answers but says what they are worth", () => {
    const u = student();
    const c = course("practice");
    const k = concept(c, "Rate limiting");
    answer(question(k), u, { gradedBy: "self" });

    const doc = buildAttestation(c, u)!;
    expect(doc.body.verifiedConcepts).toBe(1);
    expect(doc.body.assessmentMode).toBe("practice");
    // The field a reader cannot miss: this was not independently graded.
    expect(doc.body.independentlyGraded).toBe(false);
  });

  it("quotes the question as it was asked, not as it now reads", () => {
    // A rewritten module retires its questions. Quoting today's wording would
    // describe an exam this person never sat.
    const u = student();
    const c = course();
    const k = concept(c, "Failover");
    const q = question(k, "the wording after the rewrite");
    answer(q, u, { prompt: "the wording they actually saw" });

    expect(buildAttestation(c, u)!.body.trail[0]!.prompt).toBe(
      "the wording they actually saw",
    );
  });

  it("carries one person's answers only", () => {
    const rosa = student("Rosa");
    const luca = student("Luca");
    const c = course();
    const k = concept(c, "Failover");
    const q = question(k);
    answer(q, rosa, { at: T0 });
    answer(q, luca, { at: T0 + DAY, correct: false });

    const doc = buildAttestation(c, rosa)!;
    expect(doc.body.trail).toHaveLength(1);
    expect(doc.body.studentName).toBe("Rosa");
  });

  it("is willing to say that somebody has done nothing", () => {
    const u = student();
    const c = course();
    concept(c, "Failover");
    const doc = buildAttestation(c, u)!;
    expect(doc.body.verifiedConcepts).toBe(0);
    expect(doc.body.firstAnswerAt).toBeNull();
    expect(verifyAttestation(doc)).toBe(true);
  });

  it("is null for a course or a person that does not exist", () => {
    expect(buildAttestation("course_nope", student())).toBeNull();
    expect(buildAttestation(course(), "user_nope")).toBeNull();
  });
});

describe("the signature", () => {
  it("verifies a record this install issued", () => {
    const u = student();
    const c = course();
    answer(question(concept(c, "A")), u);
    expect(verifyAttestation(buildAttestation(c, u)!)).toBe(true);
  });

  it("stops matching when a mark is changed", () => {
    const u = student();
    const c = course();
    answer(question(concept(c, "A")), u, { correct: false });
    const doc = buildAttestation(c, u)!;

    doc.body.trail[0]!.correct = true;
    expect(verifyAttestation(doc)).toBe(false);
  });

  it("stops matching when the count is inflated", () => {
    const u = student();
    const c = course();
    answer(question(concept(c, "A")), u);
    const doc = buildAttestation(c, u)!;

    doc.body.verifiedConcepts = 99;
    expect(verifyAttestation(doc)).toBe(false);
  });

  it("stops matching when the record is moved to another person", () => {
    const u = student("Rosa");
    const c = course();
    answer(question(concept(c, "A")), u);
    const doc = buildAttestation(c, u)!;

    doc.body.studentName = "Somebody Else";
    expect(verifyAttestation(doc)).toBe(false);
  });

  it("rejects a missing or malformed signature rather than throwing", () => {
    const u = student();
    const c = course();
    answer(question(concept(c, "A")), u);
    const doc = buildAttestation(c, u)!;

    expect(verifyAttestation({ ...doc, signature: "" })).toBe(false);
    expect(verifyAttestation({ ...doc, signature: "abc" })).toBe(false);
    expect(
      verifyAttestation({ ...doc, signature: undefined as unknown as string }),
    ).toBe(false);
  });

  it("survives a restart, which is the only thing that makes it worth signing", () => {
    // The key lives in the settings table rather than in the process. A key
    // minted per boot would make every document issued before the last restart
    // unverifiable, which is the same as not signing them.
    const u = student();
    const c = course();
    answer(question(concept(c, "A")), u);
    const doc = buildAttestation(c, u)!;

    forgetInstallSecret();
    expect(verifyAttestation(doc)).toBe(true);
  });

  it("does not verify against a different install's key", () => {
    const u = student();
    const c = course();
    answer(question(concept(c, "A")), u);
    const doc = buildAttestation(c, u)!;

    db.delete(settingsT).run();
    forgetInstallSecret();
    db.insert(settingsT)
      .values({ key: ATTESTATION_KEY_SETTING, value: "another-install-key" })
      .run();
    expect(verifyAttestation(doc)).toBe(false);
  });
});
