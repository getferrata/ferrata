"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Add material to a finished course. The upload goes through the same DLP gate
 * as at creation; then the model reads it against the course and files
 * proposals in the Author panel. This form promises exactly that and no more:
 * nothing in the course changes until a proposal is approved.
 */
export function AddMaterial({ courseId }: { courseId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">(
    "idle",
  );
  const [error, setError] = useState("");

  async function send() {
    const files = fileRef.current?.files;
    if ((!files || files.length === 0) && !text.trim()) {
      setError("Attach a file or paste some text first.");
      return;
    }
    setState("sending");
    setError("");
    const form = new FormData();
    for (const f of files ?? []) form.append("files", f);
    if (text.trim()) form.append("text", text);
    try {
      const res = await fetch(`/api/courses/${courseId}/sources`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        queued?: boolean;
        error?: string;
        sources?: { name: string; ok: boolean; error?: string | null }[];
      };
      if (!res.ok) {
        setError(data.error ?? `Error ${res.status}`);
        setState("failed");
        return;
      }
      setText("");
      if (fileRef.current) fileRef.current.value = "";
      if (data.queued) {
        // Something readable went in; the analysis is running.
        setState("sent");
      } else {
        // Everything was blocked or unreadable, so nothing is being analysed.
        // Say why, from the per-source reasons, instead of promising proposals.
        const why = (data.sources ?? [])
          .filter((s) => !s.ok)
          .map((s) => `${s.name}${s.error ? `: ${s.error}` : ""}`)
          .join("; ");
        setError(
          why
            ? `Nothing to read. ${why}`
            : "Nothing readable was added, so there is nothing to analyse.",
        );
        setState("failed");
      }
      router.refresh();
    } catch {
      setError("The upload did not reach the server.");
      setState("failed");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-step--1 uppercase tracking-wide text-text-muted">
        Add material
      </span>
      <input
        ref={fileRef}
        id="add-material-files"
        type="file"
        multiple
        aria-label="Files to add"
        className="text-step--1 text-text-muted file:mr-3 file:rounded file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-text"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Or paste what changed…"
        aria-label="Pasted material"
        className="rounded border border-border bg-surface p-2 text-step--1 text-text"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={state === "sending"}
          className="min-h-[36px] self-start rounded border border-text px-4 text-step--1 text-text transition hover:bg-bg-subtle disabled:opacity-50"
        >
          {state === "sending" ? "Uploading…" : "Read it against the course"}
        </button>
        {state === "sent" ? (
          <span className="text-step--1 text-text-muted">
            Reading. Proposals appear below shortly.
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="text-step--1 text-danger">
            {error}
          </span>
        ) : null}
      </div>
      <p className="max-w-measure text-step--1 text-text-muted">
        Nothing changes by itself: you approve or dismiss each proposed change.
      </p>
    </div>
  );
}
