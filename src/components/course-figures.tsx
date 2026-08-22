"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface FigureView {
  id: string;
  width: number;
  height: number;
  bytes: number;
  altText: string | null;
  status: "pending" | "approved" | "rejected";
}

/**
 * The pictures found in the material, and the decision only a person can make.
 *
 * This is the gate, not a nicety. Everything else that arrives in a course goes
 * through a scanner that reads text and pulls out secrets; an image is bytes,
 * and a screenshot of a terminal with a key in it means nothing to that
 * scanner. So a figure is in the course when somebody who knows the material
 * has looked at it and said so, and not before.
 *
 * Shown large enough to actually see. A wall of thumbnails is an invitation to
 * approve everything, which is the same as having no gate at all.
 */
export function CourseFiguresPanel({
  courseId,
  figures,
}: {
  courseId: string;
  figures: FigureView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const pending = figures.filter((f) => f.status === "pending");
  const approved = figures.filter((f) => f.status === "approved");
  if (figures.length === 0) return null;

  async function decide(id: string, status: "approved" | "rejected") {
    setBusy(id);
    try {
      await fetch(`/api/courses/${courseId}/figures/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-12 rounded border border-border p-5">
      <h2 className="text-step--1 uppercase tracking-wide text-text-muted">
        Pictures from the material
      </h2>
      <p className="mt-2 max-w-measure text-step--1 text-text-muted">
        {pending.length > 0
          ? `${pending.length} waiting on you. `
          : "All decided. "}
        A picture is in the course only once you say so. Nothing scans an image
        the way the material is scanned for secrets, so this one is on you: look
        at what is actually in it, the console with a token in the corner as
        much as the whiteboard with a customer&rsquo;s name.
        {approved.length > 0
          ? ` ${approved.length} approved, and shown where they sat in the document.`
          : ""}
      </p>

      <ul className="mt-6 grid gap-6 sm:grid-cols-2">
        {figures.map((f) => (
          <li key={f.id} className="rounded border border-border/60 p-3">
            <img
              src={`/api/courses/${courseId}/figures/${f.id}`}
              alt={f.altText ?? "A picture found in the material"}
              className="max-h-72 w-full rounded object-contain"
              loading="lazy"
            />
            <p className="mt-2 text-step--2 text-text-muted">
              {f.width}×{f.height}, {Math.round(f.bytes / 1024)} kB
              {f.altText ? ` · “${f.altText}”` : ""}
            </p>
            {f.status === "pending" ? (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy === f.id}
                  onClick={() => void decide(f.id, "approved")}
                  className="rounded border border-border px-3 py-1.5 text-step--1 hover:bg-bg disabled:opacity-60"
                >
                  Put it in the course
                </button>
                <button
                  type="button"
                  disabled={busy === f.id}
                  onClick={() => void decide(f.id, "rejected")}
                  className="rounded border border-border px-3 py-1.5 text-step--1 text-text-muted hover:bg-bg disabled:opacity-60"
                >
                  Leave it out
                </button>
              </div>
            ) : (
              <p className="mt-3 flex items-center gap-3 text-step--1">
                <span
                  className={
                    f.status === "approved" ? "text-state-solid" : "text-text-muted"
                  }
                >
                  {f.status === "approved" ? "In the course" : "Left out"}
                </span>
                <button
                  type="button"
                  disabled={busy === f.id}
                  onClick={() =>
                    void decide(
                      f.id,
                      f.status === "approved" ? "rejected" : "approved",
                    )
                  }
                  className="text-step--2 text-text-muted underline underline-offset-2 disabled:opacity-60"
                >
                  change
                </button>
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
