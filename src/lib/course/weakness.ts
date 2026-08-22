import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  courses as coursesT,
  questions as questionsT,
  reviews as reviewsT,
} from "@/db/schema";

/**
 * What the class actually got wrong in a concept.
 *
 * The dashboard can already say that half the roster is weak on a module. That
 * is a diagnosis, and on its own it sends an author to rewrite blind. The
 * useful thing is one level down: which questions people fail, and what they
 * answered instead. A module rewritten against "several people cannot say what
 * empties the pool" is a different module from one rewritten against "make this
 * better".
 *
 * This is the most valuable signal the product collects, because it is the only
 * one that comes from readers rather than from a model grading itself.
 */
export interface FailedQuestion {
  prompt: string;
  expectedAnswer: string;
  /** How many students got it wrong on their latest attempt. */
  wrong: number;
  /** How many answered it at all, so "3 of 4" can be told from "3 of 30". */
  answered: number;
}

/**
 * The failed questions of several concepts at once, worst first within each.
 *
 * Batched rather than looped because the examiner dashboard asks this about
 * every weak concept on the page, and the per-concept version of the same
 * question is what made that page read the whole review table once per student.
 * Concepts with nothing worth reporting are absent from the map, not present
 * with an empty list, so a caller cannot mistake "no failures" for "no data".
 */
export function failedQuestionsByConcept(
  courseId: string,
  conceptIds: string[],
  limit = 5,
): Map<string, FailedQuestion[]> {
  const out = new Map<string, FailedQuestion[]>();
  if (conceptIds.length === 0) return out;

  const course = db
    .select({ mode: coursesT.assessmentMode })
    .from(coursesT)
    .where(eq(coursesT.id, courseId))
    .get();
  if (!course) return out;
  const assessed = course.mode === "assessed";

  const qs = db
    .select()
    .from(questionsT)
    .where(
      and(
        inArray(questionsT.conceptId, conceptIds),
        isNull(questionsT.retiredAt),
      ),
    )
    .all();
  if (qs.length === 0) return out;

  const rows = db
    .select()
    .from(reviewsT)
    .where(
      and(
        inArray(
          reviewsT.questionId,
          qs.map((q) => q.id),
        ),
        // In assessed mode only answers a machine settled count, the same rule
        // the readiness figures use. A self-grade is a student's opinion of
        // themselves, which is not evidence about the module.
        assessed ? ne(reviewsT.gradedBy, "self") : undefined,
      ),
    )
    .orderBy(desc(reviewsT.answeredAt), desc(reviewsT.id))
    .all();

  // Latest answer per student per question: an early wrong answer followed by a
  // right one is somebody who learned, not a module that fails people.
  const seen = new Set<string>();
  const tally = new Map<string, { wrong: number; answered: number }>();
  for (const r of rows) {
    const key = `${r.userId} ${r.questionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t = tally.get(r.questionId) ?? { wrong: 0, answered: 0 };
    t.answered++;
    if (!r.correct) t.wrong++;
    tally.set(r.questionId, t);
  }

  for (const q of qs) {
    const t = tally.get(q.id);
    // More readers wrong than right. A question everyone answers correctly says
    // nothing about what to rewrite, and one a single person missed is that
    // person's gap.
    if (!t || t.answered === 0 || t.wrong * 2 <= t.answered) continue;
    const bucket = out.get(q.conceptId) ?? [];
    bucket.push({
      prompt: q.prompt,
      expectedAnswer: q.expectedAnswer,
      wrong: t.wrong,
      answered: t.answered,
    });
    out.set(q.conceptId, bucket);
  }

  for (const [conceptId, bucket] of out) {
    bucket.sort((a, b) => b.wrong - a.wrong);
    out.set(conceptId, bucket.slice(0, limit));
  }
  return out;
}

/**
 * The same question about one concept, which is what a rewrite needs.
 */
export function failedQuestionsForConcept(
  courseId: string,
  conceptId: string,
  limit = 5,
): FailedQuestion[] {
  return failedQuestionsByConcept(courseId, [conceptId], limit).get(conceptId) ?? [];
}

/**
 * Those questions as instructions a rewrite can act on.
 *
 * Phrased as what the module failed to teach rather than as what the students
 * failed to learn, because the module is the thing being rewritten and blaming
 * the reader produces a module that lectures.
 */
export function rewriteNotesFromFailures(
  failures: FailedQuestion[],
): string[] {
  return failures.map(
    (f) =>
      `${f.wrong} of ${f.answered} readers answered this wrongly, so the module does not teach it clearly enough: "${f.prompt}" The answer they should have been able to give: "${f.expectedAnswer}" Cover this explicitly and concretely.`,
  );
}
