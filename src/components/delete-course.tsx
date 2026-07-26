"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Delete a course. Inline confirm (destructive, not one-click), and if students
 * are enrolled the server refuses first. We surface the count and require an
 * explicit second confirmation before forcing.
 */
export function DeleteCourse({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enrolled, setEnrolled] = useState<number | null>(null);

  async function del(force: boolean) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/courses/${courseId}${force ? "?force=1" : ""}`,
        { method: "DELETE" },
      );
      if (res.status === 409) {
        const data = (await res.json()) as { enrolled?: number };
        setEnrolled(data.enrolled ?? 0);
        setBusy(false);
        return;
      }
      if (res.ok) {
        router.push("/courses");
        return;
      }
      setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="tap self-start text-step--1 text-text-muted underline underline-offset-2 hover:text-danger"
      >
        Delete course
      </button>
    );
  }

  if (enrolled && enrolled > 0) {
    return (
      <div className="flex flex-col gap-2 text-step--1">
        <span className="text-danger">
          {enrolled} student{enrolled === 1 ? "" : "s"} enrolled: deleting the
          course also loses their progress.
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => del(true)}
            disabled={busy}
            className="rounded border border-danger px-3 py-1 text-danger hover:bg-bg-subtle disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete anyway"}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              setEnrolled(null);
            }}
            className="text-text-muted hover:text-text"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-step--1">
      <span className="text-text-muted">Delete the whole course?</span>
      <button
        type="button"
        onClick={() => del(false)}
        disabled={busy}
        className="rounded border border-danger px-3 py-1 text-danger hover:bg-bg-subtle disabled:opacity-50"
      >
        {busy ? "Deleting…" : "Yes, delete"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-text-muted hover:text-text"
      >
        Cancel
      </button>
    </div>
  );
}
