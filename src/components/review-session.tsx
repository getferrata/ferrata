"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Confidence = "low" | "medium" | "high";

interface Card {
  questionId: string;
  conceptTitle: string;
  prompt: string;
  expectedAnswer: string;
  sureWrong: boolean;
}

const CONFIDENCE: { key: Confidence; label: string }[] = [
  { key: "low", label: "Just guessing" },
  { key: "medium", label: "Fairly sure" },
  { key: "high", label: "Sure" },
];

/**
 * Interleaved spaced-review session. One card at a time:
 * confidence before reveal, self-grade after. A missed card (especially
 * sure-and-wrong) is re-queued to the end of THIS session, so the error you
 * didn't know you had comes back before you leave.
 */
export function ReviewSession({
  courseId,
  questions,
}: {
  courseId: string;
  questions: Card[];
}) {
  const initial = useMemo(() => questions, [questions]);
  const [queue, setQueue] = useState<Card[]>(initial);
  const [pos, setPos] = useState(0);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState({ answered: 0, missed: 0 });

  const card = queue[pos];
  const total = initial.length;

  function next(afterRequeue: boolean, requeued?: Card) {
    setConfidence(null);
    setRevealed(false);
    if (afterRequeue && requeued) {
      setQueue((q) => [...q, requeued]);
    }
    setPos((p) => p + 1);
  }

  async function grade(correct: boolean) {
    if (!card) return;
    const conf = confidence ?? "medium";
    void fetch("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        questionId: card.questionId,
        correct,
        confidence: conf,
        courseId,
      }),
    }).catch(() => {});
    setStats((s) => ({ answered: s.answered + 1, missed: s.missed + (correct ? 0 : 1) }));
    // Re-queue a miss so it returns before the session ends.
    next(!correct, !correct ? card : undefined);
  }

  if (!card) {
    return (
      <div className="mt-8">
        <p className="font-serif text-step-2 text-text">Done.</p>
        <p className="mt-2 text-step-0 text-text-muted">
          {stats.answered} answers this session
          {stats.missed > 0
            ? ` · ${stats.missed} to revisit, they'll come back when due`
            : " · no gaps, for now"}
          .
        </p>
        <div className="mt-6 flex gap-5 text-step-0">
          <Link href={`/courses/${courseId}`} className="text-accent underline underline-offset-2">
            Back to the route
          </Link>
          <Link
            href={`/courses/${courseId}/dashboard`}
            className="text-accent underline underline-offset-2"
          >
            What you know
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between text-step--1 text-text-muted">
        <span>{card.conceptTitle}</span>
        <span>
          {Math.min(pos + 1, total)}/{total}
          {queue.length > total ? ` (+${queue.length - total} to revisit)` : ""}
        </span>
      </div>

      <p className="mt-4 font-serif text-step-2 leading-snug text-text">
        {card.prompt}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className="text-step--1 text-text-muted">How sure are you?</span>
        {CONFIDENCE.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setConfidence(c.key)}
            aria-pressed={confidence === c.key}
            className={
              "min-h-[36px] rounded border px-3 text-step--1 transition " +
              (confidence === c.key
                ? "border-accent bg-accent text-accent-contrast"
                : "border-border text-text-muted hover:text-text")
            }
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {!revealed ? (
          <button
            type="button"
            disabled={confidence === null}
            onClick={() => setRevealed(true)}
            className="min-h-[44px] rounded border border-text px-5 text-step-0 text-text transition hover:bg-bg-subtle disabled:opacity-40"
          >
            Show the answer
          </button>
        ) : (
          <div>
            <div className="rounded bg-bg-subtle p-4 font-serif text-step-0 text-text">
              {card.expectedAnswer}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <span className="text-step--1 text-text-muted">How did it go?</span>
              <button
                type="button"
                onClick={() => grade(true)}
                className="min-h-[40px] rounded border border-state-solid px-4 text-step-0 text-state-solid hover:bg-bg-subtle"
              >
                I had it
              </button>
              <button
                type="button"
                onClick={() => grade(false)}
                className="min-h-[40px] rounded border border-danger px-4 text-step-0 text-danger hover:bg-bg-subtle"
              >
                I missed it
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
