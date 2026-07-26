"use client";

import { useState } from "react";

/**
 * Pick a failed build back up.
 *
 * The failure screen said what went wrong and left the author with nothing to
 * press, so the only way forward was to start again and pay for the interview
 * and the plan a second time. Everything already written is kept, so this
 * usually costs a fraction of the first attempt.
 */
export function RetryBuild({
  courseId,
  writtenModules,
}: {
  courseId: string;
  /** Modules already finished, so the cost of carrying on is honest. */
  writtenModules: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/retry`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      // A full load: the wait screen polls from the server, and a soft
      // navigation can paint the old failed state again.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="inline-flex min-h-[44px] items-center rounded bg-accent px-6 font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "…" : "Build again"}
      </button>
      <p className="mt-2 max-w-measure text-step--1 text-text-muted">
        {writtenModules > 0
          ? `It carries on from where it stopped: ${writtenModules} ${writtenModules === 1 ? "module is" : "modules are"} already written and will not be paid for twice.`
          : "It carries on from the furthest stage that finished, so nothing already done is redone."}
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-step--1 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
