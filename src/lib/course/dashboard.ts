import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  concepts as conceptsT,
  courses as coursesT,
  cuts as cutsT,
  explanations as explanationsT,
  questions as questionsT,
  reviews as reviewsT,
} from "@/db/schema";
import { knowledgeHeld, type StoredCard } from "@/lib/fsrs";
import { plainText } from "@/lib/text";

export interface ConceptRetention {
  conceptId: string;
  title: string;
  total: number;
  tested: number;
  retention: number | null; // knowledge held, over every question in the concept
  /** Latest explain-back verdict: explained cleanly, with a gap, or never. */
  explained: "complete" | "gappy" | null;
}

export interface SureWrong {
  questionId: string;
  conceptTitle: string;
  prompt: string;
}

export interface Dashboard {
  courseTitle: string;
  courseRetention: number | null; // the honest metric
  totalQuestions: number;
  testedCount: number;
  untestedCount: number;
  concepts: ConceptRetention[];
  sureWrong: SureWrong[];
  weakest: ConceptRetention[];
  cuts: { id: string; title: string; reason: string }[];
  /** Concepts whose latest explain-back attempt held up. */
  explainedCount: number;
}

/**
 * The honest dashboard: estimated retention from FSRS state, what you
 * don't know (weak concepts + sure-and-wrong), and the explicit cut list. Never
 * course-completion percentage.
 */
export function getDashboard(
  courseId: string,
  at: Date = new Date(),
  userId?: string,
): Dashboard | null {
  const course = db.select().from(coursesT).where(eq(coursesT.id, courseId)).get();
  if (!course) return null;

  const concepts = db
    .select()
    .from(conceptsT)
    .where(eq(conceptsT.courseId, courseId))
    .all();
  const conceptIds = concepts.map((c) => c.id);
  const titleById = new Map(concepts.map((c) => [c.id, plainText(c.title)]));

  const qs = conceptIds.length
    ? db
        .select()
        .from(questionsT)
        .where(inArray(questionsT.conceptId, conceptIds))
        .all()
    : [];

  // Latest review per question.
  const latestByQuestion = new Map<
    string,
    { correct: boolean; confidence: string; card: StoredCard | null }
  >();
  for (const q of qs) {
    const last = db
      .select()
      .from(reviewsT)
      .where(
        userId
          ? and(eq(reviewsT.questionId, q.id), eq(reviewsT.userId, userId))
          : eq(reviewsT.questionId, q.id),
      )
      .orderBy(desc(reviewsT.answeredAt))
      .limit(1)
      .get();
    if (last) {
      latestByQuestion.set(q.id, {
        correct: last.correct,
        confidence: last.confidence,
        card: last.fsrsStateJson
          ? (JSON.parse(last.fsrsStateJson) as StoredCard)
          : null,
      });
    }
  }

  const perConcept = new Map<string, { total: number; retentions: number[] }>();
  const sureWrong: SureWrong[] = [];
  let tested = 0;

  for (const q of qs) {
    const agg = perConcept.get(q.conceptId) ?? { total: 0, retentions: [] };
    agg.total++;
    const last = latestByQuestion.get(q.id);
    if (last) {
      tested++;
      agg.retentions.push(knowledgeHeld(last.card, last.correct, at));
      if (!last.correct && last.confidence === "high") {
        sureWrong.push({
          questionId: q.id,
          conceptTitle: titleById.get(q.conceptId) ?? "",
          prompt: q.prompt,
        });
      }
    }
    perConcept.set(q.conceptId, agg);
  }

  // Latest explain-back verdict per concept (per student when scoped).
  const explainedByConcept = new Map<string, "complete" | "gappy">();
  for (const c of concepts) {
    const last = db
      .select()
      .from(explanationsT)
      .where(
        userId
          ? and(eq(explanationsT.conceptId, c.id), eq(explanationsT.userId, userId))
          : eq(explanationsT.conceptId, c.id),
      )
      .orderBy(desc(explanationsT.createdAt))
      .limit(1)
      .get();
    if (last) explainedByConcept.set(c.id, last.complete ? "complete" : "gappy");
  }

  const conceptRetention: ConceptRetention[] = concepts.map((c) => {
    const agg = perConcept.get(c.id) ?? { total: 0, retentions: [] };
    const retention =
      agg.retentions.length > 0
        ? agg.retentions.reduce((s, r) => s + r, 0) / agg.retentions.length
        : null;
    return {
      conceptId: c.id,
      title: plainText(c.title),
      total: agg.total,
      tested: agg.retentions.length,
      retention,
      explained: explainedByConcept.get(c.id) ?? null,
    };
  });

  // Over every concept, not only the tested ones. "The share of concepts you
  // would still know if quizzed right now" has to count the ones you have never
  // been quizzed on, otherwise a single correct answer reads as complete
  // readiness. Null only while nothing at all has been tested, where the honest
  // answer is that there is nothing to say yet.
  const anyTested = conceptRetention.some((c) => c.retention !== null);
  const courseRetention =
    anyTested && conceptRetention.length > 0
      ? conceptRetention.reduce((sum, c) => sum + (c.retention ?? 0), 0) /
        conceptRetention.length
      : null;

  const weakest = [...conceptRetention]
    .filter((c) => c.retention !== null)
    .sort((a, b) => (a.retention as number) - (b.retention as number))
    .slice(0, 5);

  const cuts = db
    .select()
    .from(cutsT)
    .where(eq(cutsT.courseId, courseId))
    .all()
    .map((c) => ({ id: c.id, title: plainText(c.title), reason: c.reason }));

  return {
    courseTitle: plainText(course.title),
    courseRetention,
    totalQuestions: qs.length,
    testedCount: tested,
    untestedCount: qs.length - tested,
    concepts: conceptRetention,
    sureWrong,
    weakest,
    cuts,
    explainedCount: conceptRetention.filter((c) => c.explained === "complete")
      .length,
  };
}
