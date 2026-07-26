"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The badge on an imported course, and the way to clear it.
 *
 * Before this the course said "not verified by you" and offered nothing to do
 * about it, which is a dead end: the reader is told something is wrong and has
 * no way to make it right.
 */
export function VerifyCourse({
  courseId,
  verifiedByName,
  canVerify,
}: {
  courseId: string;
  /** Name of the author who vouched for it, or null if nobody has. */
  verifiedByName: string | null;
  /** False for a student, who reads the state but does not set it. */
  canVerify: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function send(method: "POST" | "DELETE") {
    setBusy(true);
    await fetch(`/api/courses/${courseId}/verify`, { method }).catch(() => {});
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  if (verifiedByName) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span
          className="rounded border px-2 py-0.5 text-step--1"
          style={{ borderColor: "var(--state-solid)", color: "var(--state-solid)" }}
        >
          imported · checked by {verifiedByName}
        </span>
        {canVerify ? (
          <button
            type="button"
            onClick={() => send("DELETE")}
            disabled={busy}
            className="tap text-step--1 text-text-muted underline underline-offset-2 hover:text-danger disabled:opacity-50"
          >
            {busy ? "…" : "withdraw"}
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="rounded border border-state-doubt px-2 py-0.5 text-step--1 text-state-doubt">
        imported · not checked yet
      </span>
      {canVerify ? (
        open ? (
          <span className="flex flex-wrap items-center gap-2 text-step--1">
            <span className="max-w-measure text-text-muted">
              Read it first. Nothing here is checked automatically: you are
              saying it matches how things actually work in your company.
            </span>
            <button
              type="button"
              onClick={() => send("POST")}
              disabled={busy}
              className="tap font-medium text-accent underline underline-offset-2 disabled:opacity-50"
            >
              {busy ? "…" : "I have read it, mark it checked"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="tap text-text-muted underline underline-offset-2"
            >
              cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="tap text-step--1 text-accent underline underline-offset-2"
          >
            check it
          </button>
        )
      ) : null}
    </span>
  );
}
