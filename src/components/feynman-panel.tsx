"use client";

import { useState } from "react";

interface Result {
  strengths: string;
  gap: string;
  complete: boolean;
}

/**
 * Feynman mode: explain it in your own words, get told where the gap
 * is, not a grade. A desirable difficulty: you retrieve and articulate before
 * seeing where you're thin.
 */
export function FeynmanPanel({
  conceptId,
  conceptTitle,
}: {
  conceptId: string;
  conceptTitle: string;
}) {
  const [text, setText] = useState("");
  // A subject-specific opener beats a hard-coded example: take the
  // headline of the concept title, before any ": subtitle".
  const label = (conceptTitle.split(/[:—–-]/)[0] ?? conceptTitle).trim();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "working" }
    | { kind: "done"; result: Result }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function submit() {
    if (text.trim().length < 15) return;
    setState({ kind: "working" });
    try {
      const res = await fetch("/api/feynman", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conceptId, explanation: text.trim() }),
      });
      const data = (await res.json()) as Result & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setState({ kind: "done", result: data });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Error",
      });
    }
  }

  return (
    <section className="mt-14 border-t border-border pt-8" aria-label="Feynman">
      <h2 className="font-serif text-step-2">
        Explain &ldquo;{label}&rdquo; in your own words
      </h2>
      <p className="mt-2 max-w-measure text-step-0 text-text-muted">
        Write it the way you&rsquo;d say it to a colleague who&rsquo;s never
        heard it, out loud if you can. When you press <em>Where am I wrong?</em> I
        compare your explanation with this module and tell you what&rsquo;s
        missing or imprecise. It isn&rsquo;t a grade: it&rsquo;s to find the gaps
        before an examiner does.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={`${label}, in your own words: …`}
        className="mt-4 w-full resize-y rounded border border-border bg-surface p-4 font-serif text-step-0 text-text placeholder:text-text-muted focus:border-text-muted focus-visible:outline-none"
      />
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={submit}
          disabled={state.kind === "working" || text.trim().length < 15}
          className="min-h-[40px] rounded bg-accent px-5 text-step-0 font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
        >
          {state.kind === "working" ? "Checking…" : "Where am I wrong?"}
        </button>
      </div>

      {state.kind === "error" ? (
        <p className="mt-4 text-step--1 text-danger">{state.message}</p>
      ) : null}

      {state.kind === "done" ? (
        <div className="mt-6 flex flex-col gap-4">
          <div className="rounded border border-state-solid p-4">
            <p className="text-step--1 uppercase tracking-wide text-state-solid">
              What you got
            </p>
            <p className="mt-1 font-serif text-step-0 text-text">
              {state.result.strengths}
            </p>
          </div>
          {!state.result.complete ? (
            <div className="rounded border border-state-doubt p-4">
              <p className="text-step--1 uppercase tracking-wide text-state-doubt">
                Where the gap is
              </p>
              <p className="mt-1 font-serif text-step-0 text-text">
                {state.result.gap}
              </p>
            </div>
          ) : (
            <p className="text-step-0 text-state-solid">
              No real gaps: the explanation holds.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
