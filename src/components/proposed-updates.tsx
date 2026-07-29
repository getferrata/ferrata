"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProposalKind } from "@/db/schema";

// Poll cadence while the model reads the material, and a ceiling so a wedged job
// cannot refresh forever. 2.5s is light (one DB read + a server re-render) and
// about 5 minutes of it covers a slow machine on a heavy call.
const POLL_MS = 2500;
const MAX_POLLS = 120;

export interface ProposalView {
  id: string;
  kind: ProposalKind;
  title: string;
  reason: string;
}

const KIND_LABEL: Record<ProposalKind, string> = {
  update_module: "Update",
  add_concept: "New module",
  retire_concept: "Retire",
};

/** What approving actually does, stated on the button's own card. */
const KIND_EFFECT: Record<ProposalKind, string> = {
  update_module:
    "Approving rewrites this module from the material, tests included. Costs about one module of a build.",
  add_concept:
    "Approving adds this concept at the end of the path and writes its module. Costs about one module of a build.",
  retire_concept:
    "Approving moves it to the cut list and deletes the module, its tests and the answers given on them.",
};

/**
 * The author's checklist: what the new material would change. Each card is one
 * decision with its consequences written on it, because approve is the moment
 * a suggestion becomes a spend or a deletion.
 */
export function ProposedUpdates({
  courseId,
  proposals,
  analysing,
}: {
  courseId: string;
  proposals: ProposalView[];
  analysing: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // The server render is a snapshot: the analysis finishes in the background and
  // nothing tells this page. While it runs, ask the server component to
  // re-render on a timer so the proposals (or none) land on their own. Without
  // this the author stares at "Reading…" until they think to reload.
  const wasAnalysing = useRef(false);
  const [finishedEmpty, setFinishedEmpty] = useState(false);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (!analysing) {
      // Went from reading to done with nothing to show: say so, rather than
      // letting the whole panel vanish with no word.
      if (wasAnalysing.current && proposals.length === 0) setFinishedEmpty(true);
      wasAnalysing.current = false;
      return;
    }
    wasAnalysing.current = true;
    setFinishedEmpty(false);
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
  }, [analysing, proposals.length, router]);

  async function decide(id: string, action: "approve" | "dismiss") {
    setBusy(id);
    try {
      const res = await fetch(`/api/courses/${courseId}/proposals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrors((e) => ({ ...e, [id]: data.error ?? `Error ${res.status}` }));
        return;
      }
      router.refresh();
    } catch {
      setErrors((e) => ({ ...e, [id]: "The decision did not reach the server." }));
    } finally {
      setBusy(null);
    }
  }

  if (proposals.length === 0 && !analysing && !finishedEmpty && !stalled)
    return null;

  return (
    <section
      aria-label="Proposed changes"
      className="mt-10 rounded border border-accent p-5"
    >
      <h2 className="font-serif text-step-2">Proposed changes</h2>
      <p className="mt-1 max-w-measure text-step--1 text-text-muted">
        What the new material would change. Nothing applies until you approve
        it.
      </p>
      {analysing ? (
        <p className="mt-3 text-step--1 text-text-muted">
          Reading the new material against the course&hellip; This updates here
          on its own, and keeps going if you leave the page.
        </p>
      ) : null}
      {stalled ? (
        <p className="mt-3 text-step--1 text-text-muted" role="status">
          Still working, or the analysis stalled. Reload the page to check.
        </p>
      ) : null}
      {finishedEmpty && !analysing && proposals.length === 0 ? (
        <p className="mt-3 text-step--1 text-text-muted" role="status">
          Read against the course. Nothing needed changing.
        </p>
      ) : null}
      <ul className="mt-4 flex flex-col gap-4">
        {proposals.map((p) => (
          <li key={p.id} className="rounded border border-border bg-surface p-4">
            <p className="text-step-0">
              <span className="mr-2 rounded border border-border px-2 py-0.5 font-mono text-step--1 uppercase tracking-wide text-text-muted">
                {KIND_LABEL[p.kind]}
              </span>
              <span className="font-serif text-text">{p.title}</span>
            </p>
            <p className="mt-2 max-w-measure text-step--1 text-text">
              {p.reason}
            </p>
            <p className="mt-2 max-w-measure text-step--1 text-text-muted">
              {KIND_EFFECT[p.kind]}
            </p>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void decide(p.id, "approve")}
                disabled={busy === p.id}
                className="min-h-[36px] rounded border border-text px-4 text-step--1 text-text transition hover:bg-bg-subtle disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => void decide(p.id, "dismiss")}
                disabled={busy === p.id}
                className="min-h-[36px] px-2 text-step--1 text-text-muted underline underline-offset-2 hover:text-text"
              >
                Dismiss
              </button>
              {errors[p.id] ? (
                <span role="alert" className="text-step--1 text-danger">
                  {errors[p.id]}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
