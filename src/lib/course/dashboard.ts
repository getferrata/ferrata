import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
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
import { autoGradable, type GradedBy } from "@/lib/review/grade";
import type { AssessmentMode } from "@/db/schema";
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
  /**
   * Who decided the answers this figure is built from.
   *
   * An open question can only be graded by the person answering it, so a
   * readiness number made entirely of self-grading measures honesty as much as
   * knowledge. Stating the split lets a reader weigh the number instead of
   * trusting it, and is the difference between practice and assessment.
   */
  evidence: { self: number; system: number; model: number };
  assessmentMode: AssessmentMode;
  /** In assessed mode: questions that exist for learning but cannot count. */
  practiceQuestions: number;
  /**
   * The confidence x correctness matrix over the latest answers, the four
   * quadrants of metacognition. `blindSpot` (wrong but sure) is the one that
   * matters: it is what the reader does not know they do not know.
   */
  matrix: {
    solid: number; // right, and sure
    underconfident: number; // right, but unsure
    honestGap: number; // wrong, and knew it
    blindSpot: number; // wrong, but sure
  };
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
    .where(
      and(eq(conceptsT.courseId, courseId), isNull(conceptsT.retiredAt)),
    )
    .all();
  const conceptIds = concepts.map((c) => c.id);
  const titleById = new Map(concepts.map((c) => [c.id, plainText(c.title)]));

  const qs = conceptIds.length
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

  // In assessed mode the figure is built only from questions the system can
  // settle, judged only by answers the student did not grade themselves. The
  // rest of the course still exists for learning; it just cannot testify.
  const assessed = course.assessmentMode === "assessed";
  const measured = assessed ? qs.filter((q) => autoGradable(q)) : qs;

  // Latest review per question.
  const latestByQuestion = new Map<
    string,
    {
      correct: boolean;
      confidence: string;
      gradedBy: GradedBy;
      card: StoredCard | null;
    }
  >();
  // One query for every review that could matter, newest first, reduced to the
  // latest per question in code. The old shape ran a SELECT per question, which
  // was 90+ round trips on a 15-concept course. (Assessed: only answers a
  // machine settled, never a self-grade.)
  const measuredIds = measured.map((q) => q.id);
  const allReviews = measuredIds.length
    ? db
        .select()
        .from(reviewsT)
        .where(
          and(
            inArray(reviewsT.questionId, measuredIds),
            userId ? eq(reviewsT.userId, userId) : undefined,
            assessed ? ne(reviewsT.gradedBy, "self") : undefined,
          ),
        )
        // Id breaks the tie: answeredAt is milliseconds, and two answers in
        // the same millisecond made "the latest" undefined, so the figure could
        // differ between two reads of the same data.
        .orderBy(desc(reviewsT.answeredAt), desc(reviewsT.id))
        .all()
    : [];
  for (const r of allReviews) {
    if (latestByQuestion.has(r.questionId)) continue; // first seen = latest
    latestByQuestion.set(r.questionId, {
      correct: r.correct,
      confidence: r.confidence,
      gradedBy: r.gradedBy,
      card: r.fsrsStateJson
        ? (JSON.parse(r.fsrsStateJson) as StoredCard)
        : null,
    });
  }

  const perConcept = new Map<string, { total: number; retentions: number[] }>();
  const sureWrong: SureWrong[] = [];
  const evidence = { self: 0, system: 0, model: 0 };
  const matrix = { solid: 0, underconfident: 0, honestGap: 0, blindSpot: 0 };
  let tested = 0;

  for (const q of measured) {
    const agg = perConcept.get(q.conceptId) ?? { total: 0, retentions: [] };
    agg.total++;
    const last = latestByQuestion.get(q.id);
    if (last) {
      tested++;
      evidence[last.gradedBy]++;
      agg.retentions.push(knowledgeHeld(last.card, last.correct, at));
      const sure = last.confidence === "high";
      if (last.correct) matrix[sure ? "solid" : "underconfident"]++;
      else matrix[sure ? "blindSpot" : "honestGap"]++;
      if (!last.correct && sure) {
        sureWrong.push({
          questionId: q.id,
          conceptTitle: titleById.get(q.conceptId) ?? "",
          prompt: q.prompt,
        });
      }
    }
    perConcept.set(q.conceptId, agg);
  }

  // Latest explain-back verdict per concept (per student when scoped), again in
  // one query reduced in code instead of a SELECT per concept.
  const explainedByConcept = new Map<string, "complete" | "gappy">();
  const allExpl = conceptIds.length
    ? db
        .select()
        .from(explanationsT)
        .where(
          and(
            inArray(explanationsT.conceptId, conceptIds),
            userId ? eq(explanationsT.userId, userId) : undefined,
          ),
        )
        .orderBy(desc(explanationsT.createdAt))
        .all()
    : [];
  for (const e of allExpl) {
    if (explainedByConcept.has(e.conceptId)) continue; // first seen = latest
    explainedByConcept.set(e.conceptId, e.complete ? "complete" : "gappy");
  }

  const conceptRetention: ConceptRetention[] = concepts.map((c) => {
    const agg = perConcept.get(c.id) ?? { total: 0, retentions: [] };
    // Divided by every question in the concept, not only the answered ones. A
    // question never asked is knowledge unmeasured, not knowledge held, so one
    // correct answer in a five-question concept is 20% held, not 100%. The
    // course figure below already does this across concepts; this closes the
    // same gap within one, and matches the roster the examiner reads.
    const retention =
      agg.total > 0 && agg.retentions.length > 0
        ? agg.retentions.reduce((s, r) => s + r, 0) / agg.total
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
  //
  // Assessed: a concept with no checkable questions leaves the denominator
  // entirely. Keeping it would count "the mode cannot measure this" as "the
  // student does not know this", and the figure could never reach 100 no matter
  // how well they answered everything measurable.
  const scored = assessed
    ? conceptRetention.filter((c) => c.total > 0)
    : conceptRetention;
  const anyTested = scored.some((c) => c.retention !== null);
  const courseRetention =
    anyTested && scored.length > 0
      ? scored.reduce((sum, c) => sum + (c.retention ?? 0), 0) / scored.length
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
    totalQuestions: measured.length,
    testedCount: tested,
    untestedCount: measured.length - tested,
    concepts: conceptRetention,
    sureWrong,
    weakest,
    cuts,
    explainedCount: conceptRetention.filter((c) => c.explained === "complete")
      .length,
    evidence,
    assessmentMode: course.assessmentMode,
    practiceQuestions: qs.length - measured.length,
    matrix,
  };
}
