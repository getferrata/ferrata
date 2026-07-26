"use client";

import { useState } from "react";

/**
 * The per-person spend ceiling. One credit is one cent of estimated provider
 * cost, so 500 credits is about five dollars. Blank means no ceiling, which is
 * the default: an install that has closed registration has already shut the
 * door, and a ceiling that appears from nowhere mid-course would be worse than
 * none at all.
 */
export function CreditLimitForm({
  initialLimit,
  initialWindowDays,
}: {
  initialLimit: number | null;
  initialWindowDays: number;
}) {
  const [limit, setLimit] = useState(
    initialLimit === null ? "" : String(initialLimit),
  );
  const [windowDays, setWindowDays] = useState(String(initialWindowDays));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/settings/credits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit, windowDays }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setState("failed");
    }
  }

  return (
    <section className="mt-12">
      <h2 className="font-serif text-step-2">Spend ceiling</h2>
      <p className="mt-2 max-w-measure text-step-0 text-text-muted">
        A cap on what one account can spend building courses. One credit is one
        cent of estimated provider cost, so 500 is about five dollars. Leave it
        blank for no cap. Local models cost nothing, so an install running on
        Ollama never touches this.
      </p>
      <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-step--1 text-text-muted">
            Credits per person
          </span>
          <input
            inputMode="numeric"
            value={limit}
            onChange={(e) => {
              setLimit(e.target.value);
              setState("idle");
            }}
            placeholder="no cap"
            className="w-40 rounded border border-border bg-surface px-3 py-2.5 text-step-0 text-text placeholder:text-text-muted focus:border-text-muted focus-visible:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-step--1 text-text-muted">
            Counted over (days)
          </span>
          <input
            inputMode="numeric"
            value={windowDays}
            onChange={(e) => {
              setWindowDays(e.target.value);
              setState("idle");
            }}
            className="w-32 rounded border border-border bg-surface px-3 py-2.5 text-step-0 text-text focus:border-text-muted focus-visible:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={state === "saving"}
          className="min-h-[44px] rounded border border-text px-5 text-step--1 text-text transition hover:bg-bg-subtle disabled:opacity-50"
        >
          {state === "saving" ? "…" : "Save ceiling"}
        </button>
        {state === "saved" ? (
          <span className="text-step--1" style={{ color: "var(--state-solid)" }}>
            Saved
          </span>
        ) : null}
      </form>
      {error ? (
        <p role="alert" className="mt-3 text-step--1 text-danger">
          {error}
        </p>
      ) : null}
      <p className="mt-3 max-w-measure text-step--1 text-text-muted">
        Spend per account is on the{" "}
        <a
          href="/examiner/users"
          className="text-accent underline underline-offset-2"
        >
          users page
        </a>
        .
      </p>
    </section>
  );
}
