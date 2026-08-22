"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Rewrite a module against the questions its readers get wrong.
 *
 * The difference from the plain rewrite on the module page is the brief. That
 * one says "write this again"; this one hands the writer the questions more of
 * the class failed than passed, and the answers they should have been able to
 * give. It is the only place in the product where reader evidence flows back
 * into the material, so it is worth the extra button.
 *
 * It costs the same as one module of a build and clears the answers given on
 * this module's tests, so it asks first and says both.
 */
export function RewriteFromFailures({
  courseId,
  moduleId,
  failedQuestions,
}: {
  courseId: string;
  moduleId: string;
  /** How many questions the rewrite would be given. Never rendered at zero. */
  failedQuestions: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<"idle" | "working" | "queued" | "failed">(
    "idle",
  );

  async function run() {
    setState("working");
    try {
      const res = await fetch(
        `/api/courses/${courseId}/modules/${moduleId}/regenerate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ useFailures: true }),
        },
      );
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setConfirming(false);
      setState("queued");
      router.refresh();
    } catch {
      setState("failed");
    }
  }

  if (state === "queued") {
    return (
      <p role="status" className="text-step--1 text-text-muted">
        Rewriting. The module page shows it landing.
      </p>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-[36px] shrink-0 rounded border border-border px-3 text-step--1 text-text-muted transition hover:bg-bg-subtle hover:text-text"
      >
        Rewrite against what they got wrong
      </button>
    );
  }

  return (
    <div className="mt-3 rounded border border-accent p-3">
      <p className="max-w-measure text-step--1 text-text">
        The writer is given the {failedQuestions}{" "}
        {failedQuestions === 1 ? "question" : "questions"} more of the class
        failed than passed, and told to cover them explicitly. This costs about
        one module of a build, and clears the answers already given on this
        module&rsquo;s tests, because the tests are rewritten with it.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={state === "working"}
          className="min-h-[36px] rounded border border-text px-4 text-step--1 text-text transition hover:bg-bg-subtle disabled:opacity-50"
        >
          {state === "working" ? "Queuing…" : "Rewrite it"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="min-h-[36px] px-2 text-step--1 text-text-muted underline underline-offset-2 hover:text-text"
        >
          Keep it as it is
        </button>
        {state === "failed" ? (
          <span role="alert" className="text-step--1 text-danger">
            Could not queue the rewrite.
          </span>
        ) : null}
      </div>
    </div>
  );
}
