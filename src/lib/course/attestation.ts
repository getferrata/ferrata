import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  concepts as conceptsT,
  courses as coursesT,
  questions as questionsT,
  reviews as reviewsT,
  users as usersT,
  type AssessmentMode,
} from "@/db/schema";
import { installSecret } from "@/lib/crypto/install-key";
import { plainText } from "@/lib/text";

/**
 * A signed statement of what somebody was shown to know, and when.
 *
 * The dashboard is for the person teaching: it moves, it is meant to move, and
 * it says what to do next. This is for a third party who was not there and has
 * no reason to trust the install: a fixed document, with the evidence attached
 * and a signature over it, that says the same thing next year as it does today.
 *
 * Everything here is already in the database. What was missing was the document
 * and the promise that it has not been edited since it was made.
 */

export const ATTESTATION_KEY_SETTING = "FERRATA_ATTESTATION_KEY";

/** How a concept earns the word "verified" in this document. */
export const VERIFIED_RULE =
  "A concept counts as verified when every live question in it has been answered correctly at least once, on evidence that counts under the course's assessment mode.";

export interface AttestationAnswer {
  conceptTitle: string;
  /** The question as it read when it was answered, not as it reads now. */
  prompt: string;
  correct: boolean;
  /** self, system or model: who decided this answer was right. */
  gradedBy: string;
  answeredAt: number;
}

export interface AttestationPoint {
  at: number;
  verifiedConcepts: number;
  /** Verified concepts over the concepts in the course, 0..1. */
  share: number;
}

export interface AttestationBody {
  version: 1;
  courseId: string;
  courseTitle: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  assessmentMode: AssessmentMode;
  /**
   * Whether the figures rest on evidence the student did not grade themselves.
   *
   * False is not a failure of the document, it is the document doing its job:
   * a practice course produces a real record of practice, and calling that an
   * attestation of knowledge would be the one lie this file exists to prevent.
   */
  independentlyGraded: boolean;
  conceptCount: number;
  verifiedConcepts: number;
  firstAnswerAt: number | null;
  lastAnswerAt: number | null;
  /** The curve, so a reader sees the learning rather than one final number. */
  timeline: AttestationPoint[];
  /** Every answer that counts, in the order it was given. */
  trail: AttestationAnswer[];
  verifiedRule: string;
  issuedAt: number;
}

export interface Attestation {
  body: AttestationBody;
  /** HMAC-SHA256 over the canonical body, hex. */
  signature: string;
}

/**
 * The body as bytes, the same way every time.
 *
 * A signature over `JSON.stringify(body)` would depend on key insertion order,
 * so a refactor that builds the same object in a different order would
 * invalidate every document ever issued without changing a single value.
 */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`)
    .join(",")}}`;
}

export function signBody(body: AttestationBody): string {
  return createHmac("sha256", installSecret(ATTESTATION_KEY_SETTING))
    .update(canonicalise(body))
    .digest("hex");
}

/**
 * Whether this document was issued by this install and has not been edited.
 *
 * Compared in constant time. The value being guarded is not the signature but
 * the claim: an attestation an auditor can forge by trying candidate signatures
 * against a fast comparison is not an attestation.
 */
export function verifyAttestation(doc: Attestation): boolean {
  const expected = Buffer.from(signBody(doc.body), "utf8");
  const given = Buffer.from(doc.signature ?? "", "utf8");
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * Build the document for one student on one course.
 *
 * Null when the course or the student does not exist. A course with no answers
 * still produces a document: "this person has been enrolled since March and has
 * answered nothing" is a true and sometimes wanted statement.
 */
export function buildAttestation(
  courseId: string,
  studentId: string,
  issuedAt: number = Date.now(),
): Attestation | null {
  const course = db
    .select()
    .from(coursesT)
    .where(eq(coursesT.id, courseId))
    .get();
  const student = db
    .select()
    .from(usersT)
    .where(eq(usersT.id, studentId))
    .get();
  if (!course || !student) return null;

  const concepts = db
    .select({ id: conceptsT.id, title: conceptsT.title })
    .from(conceptsT)
    .where(and(eq(conceptsT.courseId, courseId), isNull(conceptsT.retiredAt)))
    .all();
  const conceptIds = concepts.map((c) => c.id);
  const titleById = new Map(
    concepts.map((c) => [c.id, plainText(c.title)] as const),
  );

  const questions =
    conceptIds.length === 0
      ? []
      : db
          .select({ id: questionsT.id, conceptId: questionsT.conceptId })
          .from(questionsT)
          .where(
            and(
              inArray(questionsT.conceptId, conceptIds),
              isNull(questionsT.retiredAt),
            ),
          )
          .all();
  const conceptOfQuestion = new Map(questions.map((q) => [q.id, q.conceptId]));
  const liveByConcept = new Map<string, Set<string>>();
  for (const q of questions) {
    const set = liveByConcept.get(q.conceptId) ?? new Set<string>();
    set.add(q.id);
    liveByConcept.set(q.conceptId, set);
  }

  const questionIds = questions.map((q) => q.id);
  const answers =
    questionIds.length === 0
      ? []
      : db
          .select({
            questionId: reviewsT.questionId,
            correct: reviewsT.correct,
            gradedBy: reviewsT.gradedBy,
            answeredAt: reviewsT.answeredAt,
            prompt: reviewsT.questionPrompt,
          })
          .from(reviewsT)
          .where(
            and(
              inArray(reviewsT.questionId, questionIds),
              eq(reviewsT.userId, studentId),
            ),
          )
          .orderBy(asc(reviewsT.answeredAt))
          .all();

  // In assessed mode a self-graded answer is not evidence, which is the whole
  // difference between the two modes. In practice mode everything counts and
  // the document says, in a field a reader cannot miss, what that is worth.
  const assessed = course.assessmentMode === "assessed";
  const counts = (gradedBy: string): boolean => !assessed || gradedBy !== "self";
  const evidence = answers.filter((a) => counts(a.gradedBy));

  // Replay in order, so the timeline is the record rather than a reconstruction
  // from the end state.
  const passedQuestions = new Set<string>();
  const verifiedConcepts = new Set<string>();
  const timeline: AttestationPoint[] = [];
  const total = concepts.length;

  for (const a of evidence) {
    if (!a.correct) continue;
    if (passedQuestions.has(a.questionId)) continue;
    passedQuestions.add(a.questionId);

    const conceptId = conceptOfQuestion.get(a.questionId);
    if (!conceptId || verifiedConcepts.has(conceptId)) continue;
    const live = liveByConcept.get(conceptId);
    if (!live || live.size === 0) continue;
    const allPassed = [...live].every((q) => passedQuestions.has(q));
    if (!allPassed) continue;

    verifiedConcepts.add(conceptId);
    timeline.push({
      at: a.answeredAt,
      verifiedConcepts: verifiedConcepts.size,
      share: total > 0 ? verifiedConcepts.size / total : 0,
    });
  }

  const body: AttestationBody = {
    version: 1,
    courseId,
    courseTitle: plainText(course.title ?? ""),
    studentId,
    studentName: student.name,
    studentEmail: student.email,
    assessmentMode: course.assessmentMode,
    independentlyGraded:
      evidence.length > 0 && evidence.every((a) => a.gradedBy !== "self"),
    conceptCount: total,
    verifiedConcepts: verifiedConcepts.size,
    firstAnswerAt: answers[0]?.answeredAt ?? null,
    lastAnswerAt: answers[answers.length - 1]?.answeredAt ?? null,
    timeline,
    trail: evidence.map((a) => ({
      conceptTitle:
        titleById.get(conceptOfQuestion.get(a.questionId) ?? "") ?? "",
      // The wording as answered. A rewritten module retires its questions, so
      // the current text may be something this person never saw, and an
      // attestation that quotes it would be describing a different exam.
      prompt: plainText(a.prompt ?? ""),
      correct: a.correct,
      gradedBy: a.gradedBy,
      answeredAt: a.answeredAt,
    })),
    verifiedRule: VERIFIED_RULE,
    issuedAt,
  };

  return { body, signature: signBody(body) };
}
