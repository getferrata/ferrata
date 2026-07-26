"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Un-enroll a student from a course (examiner), with an inline confirm. */
export function RemoveStudent({
  courseId,
  userId,
}: {
  courseId: string;
  userId: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/courses/${courseId}/enroll?userId=${userId}`, {
        method: "DELETE",
      });
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="tap text-text-muted underline underline-offset-2 hover:text-danger"
      >
        Remove
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="tap text-danger hover:underline disabled:opacity-50"
      >
        {busy ? "…" : "Confirm"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="tap text-text-muted hover:text-text"
      >
        No
      </button>
    </span>
  );
}
