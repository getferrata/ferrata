import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  concepts as conceptsT,
  enrollments as enrollmentsT,
  questions as questionsT,
  reviews as reviewsT,
  users as usersT,
} from "@/db/schema";
import { knowledgeHeld, type StoredCard } from "@/lib/fsrs";

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

  const conceptIds = db
    .select({ id: conceptsT.id })
    .from(conceptsT)
    .where(eq(conceptsT.courseId, courseId))
    .all()
    .map((c) => c.id);
  const questionIds = conceptIds.length
    ? db
        .select({ id: questionsT.id })
        .from(questionsT)
        .where(inArray(questionsT.conceptId, conceptIds))
        .all()
        .map((q) => q.id)
    : [];
  const total = questionIds.length;

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

    let sum = 0;
    let n = 0;
    let sureWrong = 0;
    for (const v of latest.values()) {
      if (v.card) {
        sum += knowledgeHeld(v.card, v.correct, at);
        n += 1;
      }
      if (!v.correct && v.confidence === "high") sureWrong += 1;
    }
    // Divided by every question in the course, not by the ones answered. A
    // question never asked is not knowledge held, it is knowledge unmeasured,
    // and counting it as a pass turned four correct answers out of a hundred
    // into "100% ready".
    return {
      ...s,
      total,
      answered: latest.size,
      retention: n > 0 && total > 0 ? sum / total : null,
      sureWrong,
    };
  });
}
