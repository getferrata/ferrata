"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Rewrite one module with the model. Costs money and replaces the tests, so it
 * asks first and says both things plainly: a spend the author did not expect
 * and student answers that quietly vanished would each be worse than a dialog.
 */
export function RegenerateModule({
  courseId,
  moduleId,
}: {
  courseId: string;
  moduleId: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");

  async function run() {
    setState("working");
    try {
      const res = await fetch(
        `/api/courses/${courseId}/modules/${moduleId}/regenerate`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`Error ${res.status}`);
      // The module keeps its id across the rewrite, so stay put: a refresh
      // brings up the live "rewriting" banner, which polls until the new body
      // swaps in. No bounce to the overview, no dead query param.
      setConfirming(false);
      router.refresh();
    } catch {
      setState("failed");
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-[36px] rounded border border-border px-4 text-step--1 text-text-muted transition hover:bg-bg-subtle hover:text-text"
      >
        Rewrite with the model
      </button>
    );
  }

  return (
    <div className="rounded border border-accent p-4">
      <p className="max-w-measure text-step--1 text-text">
        This rewrites the module and its tests from your material, at the cost
        of about one module of a build. Answers students already gave on this
        module&rsquo;s tests are cleared, because the tests change with it.
      </p>
      <div className="mt-3 flex items-center gap-3">
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
