import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  concepts as conceptsT,
  courses as coursesT,
  enrollments as enrollmentsT,
  questions as questionsT,
  reviews as reviewsT,
  users as usersT,
} from "@/db/schema";
import { knowledgeHeld, type StoredCard } from "@/lib/fsrs";
import { autoGradable } from "@/lib/review/grade";

export interface StudentProgress {
  userId: string;
  name: string;
  email: string;
  total: number; // questions in the course
  answered: number; // distinct questions this student has tested
  retention: number | null; // knowledge held over the whole course (null if untested)
  sureWrong: number; // answered high-confidence but wrong (latest)
  deadline: number | null; // this student's finish-by, epoch ms
}

/**
 * The examiner's roster for one course: each enrolled student with an honest
 * measure of what they actually know: retrievability summed over every question
 * in the course, so untested material counts as not known, plus the count of
 * "sure and wrong" (the dangerous cell). Never a completion percentage, and
 * never flattering: it can only reach 100 by answering everything and holding
 * it.
 */
export function getRoster(
  courseId: string,
  at: Date = new Date(),
): StudentProgress[] {
  const students = db
    .select({
      userId: enrollmentsT.userId,
      name: usersT.name,
      email: usersT.email,
      deadline: enrollmentsT.deadline,
    })
    .from(enrollmentsT)
    .innerJoin(usersT, eq(usersT.id, enrollmentsT.userId))
    .where(eq(enrollmentsT.courseId, courseId))
    .all();
  if (students.length === 0) return [];

  // Assessed courses measure with machine-checked answers over checkable
  // questions, the same rule as the student's own dashboard. Two views of one
  // number diverging would be worse than either being wrong.
  const assessed =
    db
      .select({ mode: coursesT.assessmentMode })
      .from(coursesT)
      .where(eq(coursesT.id, courseId))
      .get()?.mode === "assessed";

  const conceptIds = db
    .select({ id: conceptsT.id })
    .from(conceptsT)
    .where(
      and(eq(conceptsT.courseId, courseId), isNull(conceptsT.retiredAt)),
    )
    .all()
    .map((c) => c.id);
  const allQuestions = conceptIds.length
    ? db
        .select()
        .from(questionsT)
        .where(
          and(
            inArray(questionsT.conceptId, conceptIds),
            isNull(questionsT.retiredAt),
          ),
        )
        .all()
    : [];
  const measured = assessed
    ? allQuestions.filter((q) => autoGradable(q))
    : allQuestions;
  const questionIds = measured.map((q) => q.id);
  const total = questionIds.length;
  const conceptOf = new Map(measured.map((q) => [q.id, q.conceptId]));
  // Every concept that has at least one measured question, so an untested
  // question weighs on its concept's score, not on the course average directly.
  const conceptTotals = new Map<string, number>();
  for (const q of measured) {
    conceptTotals.set(q.conceptId, (conceptTotals.get(q.conceptId) ?? 0) + 1);
  }

  return students.map((s) => {
    if (total === 0) {
      return { ...s, total, answered: 0, retention: null, sureWrong: 0 };
    }
    // Latest review per question for this student.
    const rows = db
      .select({
        questionId: reviewsT.questionId,
        answeredAt: reviewsT.answeredAt,
        correct: reviewsT.correct,
        confidence: reviewsT.confidence,
        fsrs: reviewsT.fsrsStateJson,
      })
      .from(reviewsT)
      .where(
        and(
          eq(reviewsT.userId, s.userId),
          inArray(reviewsT.questionId, questionIds),
          assessed ? ne(reviewsT.gradedBy, "self") : undefined,
        ),
      )
      .all();

    const latest = new Map<
      string,
      { correct: boolean; confidence: string; card: StoredCard | null }
    >();
    for (const r of rows.sort((a, b) => a.answeredAt - b.answeredAt)) {
      latest.set(r.questionId, {
        correct: r.correct,
        confidence: r.confidence,
        card: r.fsrs ? (JSON.parse(r.fsrs) as StoredCard) : null,
      });
    }

    // Knowledge held per concept, each divided by the concept's own question
    // count, then averaged across concepts. The same rule the student's own
    // dashboard uses: two views of one number must not diverge, and a flat
    // per-question average would weigh a ten-question concept ten times a
    // one-question concept where the dashboard weighs them equally.
    const heldByConcept = new Map<string, number>();
    let sureWrong = 0;
    for (const [qid, v] of latest) {
      if (v.card) {
        const cid = conceptOf.get(qid)!;
        heldByConcept.set(cid, (heldByConcept.get(cid) ?? 0) + knowledgeHeld(v.card, v.correct, at));
      }
      if (!v.correct && v.confidence === "high") sureWrong += 1;
    }
    let heldSum = 0;
    let anyAnswered = false;
    for (const [cid, cTotal] of conceptTotals) {
      if (!heldByConcept.has(cid)) continue;
      anyAnswered = true;
      heldSum += (heldByConcept.get(cid) ?? 0) / cTotal;
    }
    // Denominator matches the dashboard's `scored` set exactly: in assessed
    // mode the concepts that have a measurable question, in practice every
    // concept. A never-answered concept contributes 0, it does not vanish.
    const denom = assessed ? conceptTotals.size : conceptIds.length;
    const retention = anyAnswered && denom > 0 ? heldSum / denom : null;

    return {
      ...s,
      total,
      answered: latest.size,
      retention,
      sureWrong,
    };
  });
}
