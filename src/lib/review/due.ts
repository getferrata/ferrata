import { inArray, eq, asc, and, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  concepts as conceptsT,
  questions as questionsT,
  reviews as reviewsT,
} from "@/db/schema";
import type { QuestionFormat } from "@/db/schema";
import type { StoredCard } from "@/lib/fsrs";
import { plainText } from "@/lib/text";

export interface DueQuestion {
  questionId: string;
  conceptId: string;
  conceptTitle: string;
  prompt: string;
  expectedAnswer: string;
  /** Carried through so a review session can answer a card, not just reveal it. */
  bloomLevel: string;
  format: QuestionFormat;
  optionsJson: string | null;
  blanksJson: string | null;
  isNew: boolean;
  sureWrong: boolean;
  dueAt: number | null;
}

export interface DueSummary {
  due: number; // previously studied, now due (incl. new-lapsed)
  newCount: number; // never studied
  sureWrong: number;
}

interface Latest {
  correct: boolean;
  confidence: string;
  dueAt: number | null;
}

function latestByQuestion(
  questionIds: string[],
  userId?: string,
): Map<string, Latest> {
  const map = new Map<string, Latest>();
  if (questionIds.length === 0) return map;
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
      userId
        ? and(inArray(reviewsT.questionId, questionIds), eq(reviewsT.userId, userId))
        : inArray(reviewsT.questionId, questionIds),
    )
    .orderBy(asc(reviewsT.answeredAt))
    .all();
  for (const r of rows) {
    // rows are ascending, so the last write per question wins → the latest.
    const card = r.fsrs ? (JSON.parse(r.fsrs) as StoredCard) : null;
    map.set(r.questionId, {
      correct: r.correct,
      confidence: r.confidence,
      dueAt: card ? new Date(card.due).getTime() : null,
    });
  }
  return map;
}

function loadQuestions(courseId: string) {
  const cs = db
    .select({ id: conceptsT.id, title: conceptsT.title })
    .from(conceptsT)
    .where(
      and(eq(conceptsT.courseId, courseId), isNull(conceptsT.retiredAt)),
    )
    .all();
  const titleById = new Map(cs.map((c) => [c.id, plainText(c.title)]));
  const conceptIds = cs.map((c) => c.id);
  // Retired questions belong to a module that was rewritten: their answers stay
  // on the record, but nobody is scheduled to study them again.
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
  return { qs, titleById };
}

/** Count of what's due / new / sure-and-wrong, for the "ripassa" entry points. */
export function getDueSummary(
  courseId: string,
  at: number = Date.now(),
  userId?: string,
): DueSummary {
  const { qs } = loadQuestions(courseId);
  const latest = latestByQuestion(
    qs.map((q) => q.id),
    userId,
  );
  let due = 0;
  let newCount = 0;
  let sureWrong = 0;
  for (const q of qs) {
    const l = latest.get(q.id);
    if (!l) {
      newCount++;
      continue;
    }
    if (l.dueAt !== null && l.dueAt <= at) due++;
    if (!l.correct && l.confidence === "high") sureWrong++;
  }
  return { due, newCount, sureWrong };
}

/**
 * The interleaved review session: sure-and-wrong first, then overdue by due
 * date, then new, mixed across concepts so the same topic doesn't repeat back
 * to back (interleaving). Capped at `limit`.
 */
export function getDueSession(
  courseId: string,
  at: number = Date.now(),
  limit = 20,
  userId?: string,
): DueQuestion[] {
  const { qs, titleById } = loadQuestions(courseId);
  const latest = latestByQuestion(
    qs.map((q) => q.id),
    userId,
  );

  const items: DueQuestion[] = [];
  for (const q of qs) {
    const l = latest.get(q.id);
    const isNew = !l;
    const dueAt = l?.dueAt ?? null;
    const sureWrong = Boolean(l && !l.correct && l.confidence === "high");
    // include if new, or due now
    if (isNew || (dueAt !== null && dueAt <= at)) {
      items.push({
        questionId: q.id,
        conceptId: q.conceptId,
        conceptTitle: titleById.get(q.conceptId) ?? "",
        prompt: q.prompt,
        expectedAnswer: q.expectedAnswer,
        bloomLevel: q.bloomLevel,
        format: q.format,
        optionsJson: q.optionsJson,
        blanksJson: q.blanksJson,
        isNew,
        sureWrong,
        dueAt,
      });
    }
  }

  // Rank: sure-and-wrong, then overdue (older due first), then new.
  items.sort((a, b) => {
    if (a.sureWrong !== b.sureWrong) return a.sureWrong ? -1 : 1;
    if (a.isNew !== b.isNew) return a.isNew ? 1 : -1;
    return (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);
  });

  const capped = items.slice(0, limit);
  return interleaveByConcept(capped);
}

/** Reorder so the same concept doesn't appear back to back, preserving rank. */
function interleaveByConcept(items: DueQuestion[]): DueQuestion[] {
  const out: DueQuestion[] = [];
  const pool = [...items];
  while (pool.length > 0) {
    const lastConcept = out[out.length - 1]?.conceptId;
    const idx = pool.findIndex((q) => q.conceptId !== lastConcept);
    const pick = idx === -1 ? 0 : idx;
    out.push(pool.splice(pick, 1)[0]!);
  }
  return out;
}
