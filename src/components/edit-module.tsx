"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Hand-edit one module.
 *
 * The author is usually the person who knows the sentence is wrong, and until
 * this existed their only option was to delete the course and pay to build it
 * again. Deliberately plain: a textarea over the markdown, no rich editor to
 * mangle it, and the page re-renders through the normal pipeline so what they
 * see after saving is what a student will see.
 */
export function EditModule({
  courseId,
  moduleId,
  bodyMd,
  editedAt,
}: {
  courseId: string;
  moduleId: string;
  bodyMd: string;
  editedAt: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(bodyMd);
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  const [error, setError] = useState("");

  const dirty = draft !== bodyMd;

  async function save() {
    setState("saving");
    setError("");
    try {
      const res = await fetch(
        `/api/courses/${courseId}/modules/${moduleId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bodyMd: draft }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Error ${res.status}`);
        setState("failed");
        return;
      }
      setState("idle");
      setOpen(false);
      router.refresh();
    } catch {
      setError("The change did not reach the server.");
      setState("failed");
    }
  }

  if (!open) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setDraft(bodyMd);
            setOpen(true);
          }}
          className="min-h-[36px] rounded border border-border px-4 text-step--1 text-text-muted transition hover:bg-bg-subtle hover:text-text"
        >
          Edit this module
        </button>
        {editedAt ? (
          <span className="text-step--1 text-text-muted">
            Edited by hand on{" "}
            {new Date(editedAt).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            .
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-6 rounded border border-accent p-4">
      <label
        htmlFor="module-body"
        className="text-step--1 uppercase tracking-wide text-text-muted"
      >
        Module source (markdown)
      </label>
      <textarea
        id="module-body"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        rows={24}
        className="mono mt-2 w-full rounded border border-border bg-surface p-3 text-step--1 text-text"
      />
      <p className="mt-2 text-step--1 text-text-muted">
        Citations stay as <code className="mono">[fonte: name]</code> and
        protected values as <code className="mono">⟨cxt:…⟩</code>. Both are
        resolved when the page renders; typing a real address here would put it
        in the export.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={state === "saving" || !dirty}
          className="min-h-[40px] rounded border border-text px-5 text-step-0 text-text transition hover:bg-bg-subtle disabled:opacity-40"
        >
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError("");
          }}
          className="min-h-[40px] px-2 text-step-0 text-text-muted underline underline-offset-2 hover:text-text"
        >
          Cancel
        </button>
        {error ? (
          <span role="alert" className="text-step--1 text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
