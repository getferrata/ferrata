"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AssessmentMode } from "@/db/schema";

/**
 * What this course's tests are for. Two purposes, not a difficulty knob: the
 * model cannot calibrate difficulty in a way anyone could verify, so a slider
 * would sell a promise nothing keeps. Practice or assessed is a question the
 * examiner can actually answer.
 */
export function AssessmentToggle({
  courseId,
  mode,
}: {
  courseId: string;
  mode: AssessmentMode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function set(next: AssessmentMode) {
    if (next === mode || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/courses/${courseId}/assessment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      router.refresh();
    } catch {
      setError("Could not save the change.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-step--1 uppercase tracking-wide text-text-muted">
        Tests count as
      </span>
      <div className="flex gap-2" role="group" aria-label="Tests count as">
        <button
          type="button"
          onClick={() => void set("practice")}
          aria-pressed={mode === "practice"}
          disabled={busy}
          className={
            "min-h-[36px] rounded border px-4 text-step--1 transition disabled:opacity-60 " +
            (mode === "practice"
              ? "border-accent bg-accent text-accent-contrast"
              : "border-border text-text-muted hover:text-text")
          }
        >
          Practice
        </button>
        <button
          type="button"
          onClick={() => void set("assessed")}
          aria-pressed={mode === "assessed"}
          disabled={busy}
          className={
            "min-h-[36px] rounded border px-4 text-step--1 transition disabled:opacity-60 " +
            (mode === "assessed"
              ? "border-accent bg-accent text-accent-contrast"
              : "border-border text-text-muted hover:text-text")
          }
        >
          Assessed
        </button>
      </div>
      <p className="max-w-measure text-step--1 text-text-muted">
        {mode === "assessed"
          ? "Readiness counts only answers the system checked, over the questions it can check. Self-graded answers stay as practice."
          : "Students grade their own answers and the dashboard says so. Honest for learning, not a measurement."}
      </p>
      {error ? (
        <p role="alert" className="text-step--1 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
