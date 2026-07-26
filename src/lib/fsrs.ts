import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card,
  type Grade,
} from "ts-fsrs";

/**
 * FSRS wrapper. Scheduling is driven by results, not clicks. We map
 * the (correct, confidence) pair to an FSRS grade:
 *   - wrong               → Again
 *   - right + low conf     → Hard
 *   - right + medium conf  → Good
 *   - right + high conf    → Easy
 * "Sure and wrong" (wrong + high confidence) is still Again, but the caller
 * prioritizes it because a high-confidence miss is the most dangerous error.
 */
export type Confidence = "low" | "medium" | "high";

const f = fsrs(generatorParameters({ enable_fuzz: false }));

export function gradeFor(correct: boolean, confidence: Confidence): Grade {
  if (!correct) return Rating.Again;
  if (confidence === "low") return Rating.Hard;
  if (confidence === "high") return Rating.Easy;
  return Rating.Good;
}

/** Serialized card as stored in reviews.fsrs_state_json. */
export interface StoredCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
  learning_steps?: number;
}

function toCard(stored: StoredCard | null, now: Date): Card {
  if (!stored) return createEmptyCard(now);
  return {
    due: new Date(stored.due),
    stability: stored.stability,
    difficulty: stored.difficulty,
    elapsed_days: stored.elapsed_days,
    scheduled_days: stored.scheduled_days,
    reps: stored.reps,
    lapses: stored.lapses,
    state: stored.state,
    last_review: stored.last_review ? new Date(stored.last_review) : undefined,
    learning_steps: stored.learning_steps ?? 0,
  } as Card;
}

function fromCard(card: Card): StoredCard {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review?.toISOString(),
    learning_steps: (card as Card & { learning_steps?: number }).learning_steps,
  };
}

/** Advance a card by one review. Returns the next stored state. */
export function review(
  prior: StoredCard | null,
  correct: boolean,
  confidence: Confidence,
  now: Date = new Date(),
): { next: StoredCard; grade: Grade } {
  const card = toCard(prior, now);
  const grade = gradeFor(correct, confidence);
  const { card: nextCard } = f.next(card, now, grade);
  return { next: fromCard(nextCard), grade };
}

/**
 * Estimated retention right now for a card: the probability it would be recalled
 * (the honest metric). Falls with time if not reviewed.
 */
export function retrievability(
  stored: StoredCard | null,
  now: Date = new Date(),
): number {
  if (!stored) return 0;
  return f.get_retrievability(toCard(stored, now), now, false) as number;
}

/**
 * How much a single answered question counts towards readiness.
 *
 * A wrong answer counts as nothing, however recent. FSRS retrievability is a
 * function of time since the last review, so straight after answering it reads
 * near 1 whether the answer was right or wrong: right for deciding when to ask
 * again, wrong for "do they know this now". Getting it wrong five minutes ago
 * is the clearest evidence there is that they do not.
 *
 * A correct answer counts as its retrievability, so it decays if never revisited.
 */
export function knowledgeHeld(
  card: StoredCard | null,
  correct: boolean,
  at: Date,
): number {
  if (!correct) return 0;
  return retrievability(card, at);
}
