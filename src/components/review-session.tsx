"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { countBlanks, shuffledOptions } from "@/lib/review/grade";
import type { ClientQuestion } from "@/lib/review/grade";

type Confidence = "low" | "medium" | "high";

type Card = ClientQuestion & {
  conceptTitle: string;
  sureWrong: boolean;
};

interface Reveal {
  correctIndex: number | null;
  expectedAnswer: string | null;
}

const CONFIDENCE: { key: Confidence; label: string }[] = [
  { key: "low", label: "Just guessing" },
  { key: "medium", label: "Fairly sure" },
  { key: "high", label: "Sure" },
];

/** Where one card is: being answered, or answered and showing its result. */
type Phase = "asking" | "revealed";

/**
 * Interleaved spaced-review session. One card at a time: confidence before
 * reveal. A question the system can settle is answered and the server decides;
 * anything only a reader can judge is self-graded. A failed save is shown as a
 * failed save, never as a graded miss, and a missed card (especially
 * sure-and-wrong) is re-queued so the error comes back before you leave.
 */
export function ReviewSession({
  courseId,
  questions,
  assessed = false,
}: {
  courseId: string;
  questions: Card[];
  /** Assessed course: a machine-settled answer counts once and is not retaken. */
  assessed?: boolean;
}) {
  const initial = useMemo(() => questions, [questions]);
  const [queue, setQueue] = useState<Card[]>(initial);
  const [pos, setPos] = useState(0);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [blanks, setBlanks] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("asking");
  const [outcome, setOutcome] = useState<boolean | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [stats, setStats] = useState({ answered: 0, missed: 0 });

  const card = queue[pos];
  const total = initial.length;

  const usableMcq =
    card?.format === "mcq" && card.options !== null && card.options.length >= 2;
  const blankCount = card ? countBlanks(card.prompt) : 0;
  const usableCloze =
    card?.format === "cloze" && card.autoGraded && blankCount > 0;
  const auto = usableMcq || usableCloze;

  const shown = useMemo(
    () => (usableMcq && card ? shuffledOptions(card.options!, card.id) : []),
    [usableMcq, card],
  );

  function advance() {
    // A missed card comes back later in the same session, which is the point of
    // retrieval practice. Not in an assessed course: there the answer has just
    // been settled and counts once, so putting it back would only offer a
    // retake the server is going to refuse.
    const requeue = outcome === false && !(assessed && auto) ? card : undefined;
    setConfidence(null);
    setChoice(null);
    setBlanks([]);
    setPhase("asking");
    setOutcome(null);
    setReveal(null);
    setSaving(false);
    setSaveError(false);
    if (requeue) setQueue((q) => [...q, requeue]);
    setPos((p) => p + 1);
  }

  /**
   * Send the answer and wait for the verdict. On failure nothing is recorded
   * and nothing is shown as graded: a network error is not a miss, and the card
   * stays answerable.
   */
  async function answer(body: Record<string, unknown>) {
    if (!card || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          questionId: card.id,
          confidence: confidence ?? "medium",
          courseId,
          ...body,
        }),
      });
      if (!res.ok) {
        setSaving(false);
        setSaveError(true);
        return;
      }
      const data = (await res.json()) as { correct?: boolean; reveal?: Reveal };
      const correct = data.correct === true;
      setReveal(data.reveal ?? null);
      setOutcome(correct);
      setPhase("revealed");
      setSaving(false);
      setStats((s) => ({
        answered: s.answered + 1,
        missed: s.missed + (correct ? 0 : 1),
      }));
    } catch {
      setSaving(false);
      setSaveError(true);
    }
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

  const filledBlanks = Array.from(
    { length: blankCount },
    (_, i) => blanks[i] ?? "",
  );
  const ready =
    confidence !== null &&
    (!usableMcq || choice !== null) &&
    (!usableCloze || filledBlanks.every((b) => b.trim().length > 0));
  const locked = phase === "revealed";
  const answerText = reveal?.expectedAnswer ?? card.expectedAnswer;
  const correctIndex = reveal?.correctIndex ?? card.correctIndex;

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
            disabled={locked}
            className={
              "min-h-[36px] rounded border px-3 text-step--1 transition disabled:opacity-60 " +
              (confidence === c.key
                ? "border-accent bg-accent text-accent-contrast"
                : "border-border text-text-muted hover:text-text")
            }
          >
            {c.label}
          </button>
        ))}
      </div>

      {usableMcq ? (
        <fieldset className="mt-6 flex flex-col gap-2" disabled={locked}>
          <legend className="sr-only">Choose one</legend>
          {shown.map((o) => (
            <label
              key={o.index}
              className={
                "flex cursor-pointer items-start gap-3 rounded border p-3 text-step-0 transition " +
                (choice === o.index
                  ? "border-accent"
                  : "border-border hover:bg-bg-subtle") +
                (locked && correctIndex === o.index ? " border-state-solid" : "")
              }
            >
              <input
                type="radio"
                name={`card-${card.id}`}
                checked={choice === o.index}
                onChange={() => setChoice(o.index)}
                className="mt-1"
              />
              <span>{o.text}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {usableCloze ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {Array.from({ length: blankCount }, (_, i) => (
            <input
              key={i}
              type="text"
              value={blanks[i] ?? ""}
              onChange={(e) =>
                setBlanks((b) => {
                  const next = [...b];
                  next[i] = e.target.value;
                  return next;
                })
              }
              disabled={locked}
              aria-label={`Blank ${i + 1}`}
              className="min-h-[40px] rounded border border-border bg-surface px-3 text-step-0 text-text disabled:opacity-60"
            />
          ))}
        </div>
      ) : null}

      <div className="mt-6">
        {phase === "asking" ? (
          <>
            <button
              type="button"
              disabled={!ready || saving}
              onClick={() => {
                if (usableMcq) {
                  void answer({ choiceIndex: choice });
                } else if (usableCloze) {
                  void answer({ blanks: filledBlanks });
                } else {
                  // Only the reader can judge this one, so reveal and let them.
                  setPhase("revealed");
                }
              }}
              className="min-h-[44px] rounded border border-text px-5 text-step-0 text-text transition hover:bg-bg-subtle disabled:opacity-40"
            >
              {saving ? "Checking…" : auto ? "Answer" : "Show the answer"}
            </button>
            {saveError ? (
              <p className="mt-3 text-step--1 text-danger">
                Not saved: the review didn&rsquo;t reach the server. Try again.
              </p>
            ) : null}
          </>
        ) : (
          <div>
            {answerText ? (
              <div className="rounded bg-bg-subtle p-4 font-serif text-step-0 text-text">
                {answerText}
              </div>
            ) : null}

            {!auto && outcome === null ? (
              <div className="mt-4 flex items-center gap-3">
                <span className="text-step--1 text-text-muted">
                  How did it go?
                </span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void answer({ correct: true })}
                  className="min-h-[40px] rounded border border-state-solid px-4 text-step-0 text-state-solid hover:bg-bg-subtle disabled:opacity-50"
                >
                  I had it
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void answer({ correct: false })}
                  className="min-h-[40px] rounded border border-danger px-4 text-step-0 text-danger hover:bg-bg-subtle disabled:opacity-50"
                >
                  I missed it
                </button>
                {saveError ? (
                  <span className="text-step--1 text-danger">
                    Not saved. Try again.
                  </span>
                ) : null}
              </div>
            ) : outcome !== null ? (
              <div className="mt-4 flex items-center gap-4">
                <span
                  className={
                    "text-step-0 " +
                    (outcome
                      ? "text-state-solid"
                      : confidence === "high"
                        ? "text-danger"
                        : "text-text-muted")
                  }
                >
                  {outcome
                    ? "Right."
                    : confidence === "high"
                      ? "Sure and wrong: this one comes back first."
                      : "Not this time. It comes back."}
                </span>
                <button
                  type="button"
                  onClick={advance}
                  className="min-h-[40px] rounded border border-text px-4 text-step-0 text-text hover:bg-bg-subtle"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
