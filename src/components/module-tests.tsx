"use client";

import { useMemo, useState } from "react";
import { countBlanks, shuffledOptions } from "@/lib/review/grade";
import type { ClientQuestion } from "@/lib/review/grade";

type Confidence = "low" | "medium" | "high";

export type Q = ClientQuestion;

interface Reveal {
  correctIndex: number | null;
  expectedAnswer: string | null;
}

interface QState {
  confidence: Confidence | null;
  /** Multiple choice: the stored (original) index the student picked. */
  choice: number | null;
  /** Cloze: one entry per blank. */
  blanks: string[];
  revealed: boolean;
  correct: boolean | null;
  reveal: Reveal | null;
  saving: boolean;
  saveError: boolean;
  /** The server declined this answer on purpose, and said why. */
  refusal: string | null;
}

const CONFIDENCE: { key: Confidence; label: string }[] = [
  { key: "low", label: "Just guessing" },
  { key: "medium", label: "Fairly sure" },
  { key: "high", label: "Sure" },
];

/**
 * Inline retrieval practice. Confidence before reveal, so the dangerous
 * "sure and wrong" cell can be surfaced.
 *
 * A question the system can settle is answered, not self-graded: the server
 * decides against the stored answer and returns the verdict, so what an
 * examiner reads is not the student's own opinion of themselves. In an assessed
 * course the correct answer is not even on the page until the student has
 * answered; the reveal below is driven by the server's response.
 */
export function ModuleTests({
  courseId,
  moduleTitle,
  questions,
}: {
  courseId: string;
  moduleTitle: string;
  questions: Q[];
}) {
  const [states, setStates] = useState<Record<string, QState>>(() =>
    Object.fromEntries(
      questions.map((q) => [
        q.id,
        {
          confidence: null,
          choice: null,
          blanks: Array(Math.max(countBlanks(q.prompt), 1)).fill(""),
          revealed: false,
          correct: null,
          reveal: null,
          saving: false,
          saveError: false,
          refusal: null,
        } satisfies QState,
      ]),
    ),
  );

  const gradedCount = Object.values(states).filter(
    (s) => s.correct !== null,
  ).length;

  function patch(id: string, p: Partial<QState>) {
    setStates((s) => ({ ...s, [id]: { ...s[id]!, ...p } }));
  }

  /**
   * Send an answer and wait for the verdict. On a failed save nothing is
   * recorded and nothing is revealed as graded: the student is told it did not
   * save, not that they were wrong. Revealing an answer is not answering it,
   * and a network error is not a miss.
   */
  async function submit(q: Q, body: Record<string, unknown>, revealAfter: boolean) {
    if (states[q.id]?.saving) return; // in-flight: ignore a second click
    patch(q.id, { saving: true, saveError: false, refusal: null });
    const confidence = states[q.id]?.confidence ?? "medium";
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId: q.id, confidence, courseId, ...body }),
        keepalive: true,
      });
      if (!res.ok) {
        // 409 is not a failure to save: it is the assessed-mode rule that an
        // answer counts once. Saying "it did not save" there would invite a
        // retry that is meant to be refused.
        const msg =
          res.status === 409
            ? ((await res.json().catch(() => ({}))) as { error?: string })
                .error ?? "Already answered."
            : null;
        patch(q.id, { saving: false, saveError: !msg, refusal: msg });
        return;
      }
      const data = (await res.json()) as { correct?: boolean; reveal?: Reveal };
      patch(q.id, {
        saving: false,
        correct: data.correct === true,
        reveal: data.reveal ?? null,
        revealed: revealAfter ? true : states[q.id]?.revealed ?? false,
      });
    } catch {
      patch(q.id, { saving: false, saveError: true });
    }
  }

  return (
    <section className="mt-14 border-t-2 border-accent pt-8" aria-label="Anchors">
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-step-2">Anchors</h2>
        <span className="text-step--1 text-text-muted">
          {gradedCount}/{questions.length}
        </span>
      </div>
      <p className="mt-2 max-w-measure text-step-0 text-text-muted">
        The test is how you learn, not the score that comes after. Choose how
        sure you are <em>before</em> you see the answer.
      </p>

      <ol className="mt-8 flex flex-col gap-6">
        {questions.map((q, i) => (
          <QuestionCard
            key={q.id}
            q={q}
            index={i}
            state={states[q.id]!}
            onConfidence={(c) => patch(q.id, { confidence: c })}
            onChoice={(index) => patch(q.id, { choice: index })}
            onBlank={(at, value) => {
              const next = [...(states[q.id]?.blanks ?? [])];
              next[at] = value;
              patch(q.id, { blanks: next });
            }}
            onReveal={() => patch(q.id, { revealed: true })}
            onSubmit={(body, revealAfter) => void submit(q, body, revealAfter)}
          />
        ))}
      </ol>
      <p className="mt-6 text-step--1 text-text-muted">{moduleTitle}</p>
    </section>
  );
}

function QuestionCard({
  q,
  index,
  state: st,
  onConfidence,
  onChoice,
  onBlank,
  onReveal,
  onSubmit,
}: {
  q: Q;
  index: number;
  state: QState;
  onConfidence: (c: Confidence) => void;
  onChoice: (index: number) => void;
  onBlank: (at: number, value: string) => void;
  onReveal: () => void;
  onSubmit: (body: Record<string, unknown>, revealAfter: boolean) => void;
}) {
  // Only a question with usable options/blanks is machine-graded. A cloze with
  // no stored answers, or an mcq whose options did not parse, falls back to the
  // self-graded flow so it can still be answered and advanced past.
  const usableMcq = q.format === "mcq" && q.options !== null && q.options.length >= 2;
  const blankCount = countBlanks(q.prompt);
  const usableCloze = q.format === "cloze" && q.autoGraded && blankCount > 0;
  const auto = usableMcq || usableCloze;

  const shown = useMemo(
    () => (usableMcq ? shuffledOptions(q.options!, q.id) : []),
    [usableMcq, q.options, q.id],
  );

  const dangerous = st.correct === false && st.confidence === "high";
  const good = st.correct === true;
  const answer = st.reveal?.expectedAnswer ?? q.expectedAnswer;
  const correctIndex = st.reveal?.correctIndex ?? q.correctIndex;

  const ready =
    st.confidence !== null &&
    (!usableMcq || st.choice !== null) &&
    (!usableCloze || st.blanks.slice(0, blankCount).every((b) => b.trim()));

  return (
    <li
      className={
        "rounded border p-5 " +
        (dangerous
          ? "border-danger"
          : good
            ? "border-state-solid"
            : "border-border bg-surface")
      }
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 font-mono text-step--1 text-text-muted">
          {index + 1}
        </span>
        <p className="font-serif text-step-1 leading-snug text-text">
          {q.prompt}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 pl-7">
        <span className="text-step--1 text-text-muted">How sure are you?</span>
        {CONFIDENCE.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => onConfidence(c.key)}
            aria-pressed={st.confidence === c.key}
            disabled={st.revealed}
            className={
              "min-h-[32px] rounded border px-3 text-step--1 transition disabled:opacity-60 " +
              (st.confidence === c.key
                ? "border-accent bg-accent text-accent-contrast"
                : "border-border text-text-muted hover:text-text")
            }
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Answering, per format. Disabled once graded: a review is a record of
          what happened, not a field to keep editing. */}
      {usableMcq ? (
        <fieldset className="mt-4 flex flex-col gap-2 pl-7" disabled={st.revealed}>
          <legend className="sr-only">Choose one</legend>
          {shown.map((o) => (
            <label
              key={o.index}
              className={
                "flex cursor-pointer items-start gap-3 rounded border p-3 text-step-0 transition " +
                (st.choice === o.index
                  ? "border-accent"
                  : "border-border hover:bg-bg-subtle") +
                (st.revealed && correctIndex === o.index
                  ? " border-state-solid"
                  : "")
              }
            >
              <input
                type="radio"
                name={`q-${q.id}`}
                checked={st.choice === o.index}
                onChange={() => onChoice(o.index)}
                className="mt-1"
              />
              <span>{o.text}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {usableCloze ? (
        <div className="mt-4 flex flex-wrap gap-2 pl-7">
          {Array.from({ length: blankCount }, (_, i) => (
            <input
              key={i}
              type="text"
              value={st.blanks[i] ?? ""}
              onChange={(e) => onBlank(i, e.target.value)}
              disabled={st.revealed}
              aria-label={`Blank ${i + 1}`}
              className="min-h-[36px] rounded border border-border bg-surface px-3 text-step-0 text-text disabled:opacity-60"
            />
          ))}
        </div>
      ) : null}

      <div className="mt-4 pl-7">
        {!st.revealed ? (
          <button
            type="button"
            disabled={!ready || st.saving}
            onClick={() => {
              if (usableMcq) {
                onSubmit({ choiceIndex: st.choice }, true);
              } else if (usableCloze) {
                onSubmit({ blanks: st.blanks.slice(0, blankCount) }, true);
              } else {
                // Self-graded: reveal locally, the student decides after.
                onReveal();
              }
            }}
            className="min-h-[36px] rounded border border-text px-4 text-step-0 text-text transition hover:bg-bg-subtle disabled:opacity-40"
          >
            {st.saving ? "Checking…" : auto ? "Answer" : "Show the answer"}
          </button>
        ) : (
          <div>
            {answer ? (
              <div className="rounded bg-bg-subtle p-4 font-serif text-step-0 text-text">
                {answer}
              </div>
            ) : auto && st.correct === false ? (
              // Assessed course, answered wrong: the answer stays withheld, and
              // saying so plainly is better than an empty box that reads like a
              // bug. It counted once; the module is where to go back to.
              <p className="text-step--1 text-text-muted">
                Not right. The answer stays hidden in an assessed course: go
                back to the module and find it there.
              </p>
            ) : null}
            {!auto && st.correct === null ? (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-step--1 text-text-muted">
                  How did it go?
                </span>
                <button
                  type="button"
                  disabled={st.saving}
                  onClick={() => onSubmit({ correct: true }, true)}
                  className="min-h-[32px] rounded border border-state-solid px-3 text-step--1 text-state-solid hover:bg-bg-subtle disabled:opacity-50"
                >
                  I had it
                </button>
                <button
                  type="button"
                  disabled={st.saving}
                  onClick={() => onSubmit({ correct: false }, true)}
                  className="min-h-[32px] rounded border border-danger px-3 text-step--1 text-danger hover:bg-bg-subtle disabled:opacity-50"
                >
                  I missed it
                </button>
              </div>
            ) : (
              <Verdict st={st} dangerous={dangerous} />
            )}
          </div>
        )}
        {st.saveError ? (
          <p className="mt-3 text-step--1 text-danger">
            Not saved: the review didn&rsquo;t reach the server. It won&rsquo;t
            count until you answer again.
          </p>
        ) : null}
        {st.refusal ? (
          <p className="mt-3 text-step--1 text-text-muted">{st.refusal}</p>
        ) : null}
      </div>
    </li>
  );
}

function Verdict({ st, dangerous }: { st: QState; dangerous: boolean }) {
  if (st.saving) {
    return <p className="mt-3 text-step--1 text-text-muted">Saving&hellip;</p>;
  }
  if (dangerous) {
    return (
      <p className="mt-3 text-step--1 text-danger">
        Sure and wrong: the mistake you didn&rsquo;t know you had. It comes back
        first and most often.
      </p>
    );
  }
  if (st.correct === false) {
    return <p className="mt-3 text-step--1 text-danger">Not this time.</p>;
  }
  if (st.correct === true) {
    return <p className="mt-3 text-step--1 text-state-solid">Right.</p>;
  }
  return null;
}
