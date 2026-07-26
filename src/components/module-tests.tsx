"use client";

import { useState } from "react";

type Confidence = "low" | "medium" | "high";

interface Q {
  id: string;
  prompt: string;
  expectedAnswer: string;
  bloomLevel: string;
}

interface QState {
  confidence: Confidence | null;
  revealed: boolean;
  correct: boolean | null;
  saved: "saving" | "saved" | "failed" | null;
}

const CONFIDENCE: { key: Confidence; label: string }[] = [
  { key: "low", label: "Just guessing" },
  { key: "medium", label: "Fairly sure" },
  { key: "high", label: "Sure" },
];

/**
 * Inline retrieval practice. The primary action after reading
 * is to test yourself; confidence is captured BEFORE the answer is revealed, so
 * we can surface the dangerous "sure and wrong" cell. Nothing is revealed until
 * a confidence is chosen (desirable difficulty).
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
        { confidence: null, revealed: false, correct: null, saved: null },
      ]),
    ),
  );

  const gradedCount = Object.values(states).filter(
    (s) => s.correct !== null,
  ).length;

  function setConfidence(id: string, c: Confidence) {
    setStates((s) => ({ ...s, [id]: { ...s[id]!, confidence: c } }));
  }
  function reveal(id: string) {
    setStates((s) => ({ ...s, [id]: { ...s[id]!, revealed: true } }));
  }
  function grade(id: string, correct: boolean) {
    setStates((s) => ({ ...s, [id]: { ...s[id]!, correct, saved: "saving" } }));
    const confidence = states[id]?.confidence ?? "medium";
    // The review IS the product's memory: confirm the write, never fake it.
    // keepalive lets the request survive an immediate navigation away.
    fetch("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: id, correct, confidence, courseId }),
      keepalive: true,
    })
      .then((res) => {
        setStates((s) => ({
          ...s,
          [id]: { ...s[id]!, saved: res.ok ? "saved" : "failed" },
        }));
      })
      .catch(() => {
        setStates((s) => ({ ...s, [id]: { ...s[id]!, saved: "failed" } }));
      });
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
        {questions.map((q, i) => {
          const st = states[q.id]!;
          const dangerous =
            st.correct === false && st.confidence === "high";
          const good = st.correct === true;
          return (
            <li
              key={q.id}
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
                  {i + 1}
                </span>
                <p className="font-serif text-step-1 leading-snug text-text">
                  {q.prompt}
                </p>
              </div>

              {/* Confidence, captured before reveal */}
              <div className="mt-4 flex flex-wrap items-center gap-2 pl-7">
                <span className="text-step--1 text-text-muted">
                  How sure are you?
                </span>
                {CONFIDENCE.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setConfidence(q.id, c.key)}
                    aria-pressed={st.confidence === c.key}
                    className={
                      "min-h-[32px] rounded border px-3 text-step--1 transition " +
                      (st.confidence === c.key
                        ? "border-accent bg-accent text-accent-contrast"
                        : "border-border text-text-muted hover:text-text")
                    }
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              {/* Reveal / answer */}
              <div className="mt-4 pl-7">
                {!st.revealed ? (
                  <button
                    type="button"
                    disabled={st.confidence === null}
                    onClick={() => reveal(q.id)}
                    className="min-h-[36px] rounded border border-text px-4 text-step-0 text-text transition hover:bg-bg-subtle disabled:opacity-40"
                  >
                    Show the answer
                  </button>
                ) : (
                  <div>
                    <div className="rounded bg-bg-subtle p-4 font-serif text-step-0 text-text">
                      {q.expectedAnswer}
                    </div>
                    {st.correct === null ? (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-step--1 text-text-muted">
                          How did it go?
                        </span>
                        <button
                          type="button"
                          onClick={() => grade(q.id, true)}
                          className="min-h-[32px] rounded border border-state-solid px-3 text-step--1 text-state-solid hover:bg-bg-subtle"
                        >
                          I had it
                        </button>
                        <button
                          type="button"
                          onClick={() => grade(q.id, false)}
                          className="min-h-[32px] rounded border border-danger px-3 text-step--1 text-danger hover:bg-bg-subtle"
                        >
                          I missed it
                        </button>
                      </div>
                    ) : dangerous ? (
                      <p className="mt-3 text-step--1 text-danger">
                        Sure and wrong: the mistake you didn&rsquo;t know you had.
                        It comes back first and most often.
                      </p>
                    ) : st.saved === "failed" ? (
                      <p className="mt-3 text-step--1 text-danger">
                        Not saved: the review didn&rsquo;t reach the server. It
                        won&rsquo;t count until you answer again.
                      </p>
                    ) : st.saved === "saving" ? (
                      <p className="mt-3 text-step--1 text-text-muted">
                        Saving&hellip;
                      </p>
                    ) : (
                      <p className="mt-3 text-step--1 text-text-muted">
                        Recorded.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-6 text-step--1 text-text-muted">{moduleTitle}</p>
    </section>
  );
}
