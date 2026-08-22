"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ModuleWork } from "@/lib/course/work";

// Same cadence as the other live panels. The ceiling matches the deadline the
// worker holds a rewrite to, so the page stops refreshing at roughly the point
// the job is given up on rather than long before it.
const POLL_MS = 2500;
const MAX_POLLS = 720;

/**
 * What is happening to this module, while it happens.
 *
 * The page is a server snapshot, so a rewrite left it showing the old body
 * until the author reloaded and guessed whether the swap had landed. Worse, a
 * rewrite that failed left the same page as one that was never asked for: the
 * click looked ignored when it had in fact been carried out and had stopped
 * with a reason nobody was shown.
 *
 * So three states, not one flag. Queued and running poll until the new body
 * appears in place, which works because the module keeps its id across the
 * swap. Failed stays put and gives the reason.
 */
export function ModuleRewriting({ work }: { work: ModuleWork }) {
  const router = useRouter();
  const [stalled, setStalled] = useState(false);
  const live = work.state === "queued" || work.state === "running";

  useEffect(() => {
    if (!live) return;
    setStalled(false);
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      if (n > MAX_POLLS) {
        clearInterval(t);
        setStalled(true);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [live, router]);

  if (work.state === "failed") {
    return (
      <div
        role="alert"
        className="mb-6 rounded border border-danger bg-bg-subtle px-4 py-3 text-step--1"
      >
        <p className="text-danger">The rewrite of this module stopped.</p>
        <p className="mt-1 break-words text-text-muted">{work.error}</p>
        <p className="mt-1 text-text-muted">
          What you are reading below is the module as it was, untouched. Ask for
          the rewrite again once the reason above is dealt with.
        </p>
      </div>
    );
  }

  if (!live && !stalled) return null;

  return (
    <div
      role="status"
      className="mb-6 rounded border border-accent bg-bg-subtle px-4 py-3 text-step--1 text-text"
    >
      {stalled
        ? "Still rewriting, or the rewrite stalled. Reload the page to check."
        : work.state === "queued"
          ? "Queued behind other work on this course. It starts on its own, and this page updates when it does."
          : "Rewriting this module and its tests from your material. It updates here on its own, in a minute or two. You can leave and come back."}
    </div>
  );
}
