"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CourseGaps } from "@/lib/course/gaps";

/**
 * What the finished course is missing, said where the author sees the course.
 *
 * The build degrades instead of dying, which is right, and until this existed
 * that was the whole story: a module could ship with no test at all and a
 * concept could end up with no module, and the course said `ready` either way.
 * The dashboard could not help, since "still to test" counts questions the
 * reader has not reached and a module with none does not appear in it.
 *
 * Written as a fact and a price, not a warning banner. The author is being
 * asked to spend on a repair, and the number of calls it costs belongs on the
 * button rather than in a surprise on the receipt.
 */
export function CourseGapsPanel({
  courseId,
  gaps,
}: {
  courseId: string;
  gaps: CourseGaps;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "queued" | "failed">(
    "idle",
  );
  const count = gaps.missing.length + gaps.untested.length;
  if (count === 0) return null;

  async function fill() {
    setState("working");
    try {
      const res = await fetch(`/api/courses/${courseId}/gaps`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setState("queued");
      router.refresh();
    } catch {
      setState("failed");
    }
  }

  return (
    <section className="mt-12 rounded border border-state-weak/40 bg-bg-subtle p-5">
      <h2 className="text-step--1 uppercase tracking-wide text-text-muted">
        What this course is missing
      </h2>
      <p className="mt-2 text-step--1 text-text-muted">
        The build finished, but not everything in it did. Until these are filled
        the course claims more than it can show.
      </p>

      {gaps.missing.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-step--1 font-medium">
            {gaps.missing.length} concept
            {gaps.missing.length === 1 ? "" : "s"} with no module
          </h3>
          <p className="mt-1 text-step--2 text-text-muted">
            Planned, then never written. A reader following the path finds
            nothing here.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {gaps.missing.map((g) => (
              <li key={g.conceptId} className="text-step--1">
                {g.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {gaps.untested.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-step--1 font-medium">
            {gaps.untested.length} module
            {gaps.untested.length === 1 ? "" : "s"} with no test
          </h3>
          <p className="mt-1 text-step--2 text-text-muted">
            Written, and measuring nothing. A reader opens it, marks it done and
            neither of you learns whether it landed.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {gaps.untested.map((g) => (
              <li key={g.conceptId} className="text-step--1">
                {g.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={fill}
          disabled={state === "working" || state === "queued"}
          className="rounded border border-border px-3 py-2 text-step--1 hover:bg-bg disabled:opacity-60"
        >
          {state === "working"
            ? "Queueing…"
            : state === "queued"
              ? "Queued"
              : `Write the missing ${count === 1 ? "one" : count}`}
        </button>
        <span className="text-step--2 text-text-muted">
          Costs about {count} module{count === 1 ? "" : "s"} of a build. A module
          rewritten this way replaces its tests.
        </span>
      </div>
      {state === "failed" ? (
        <p className="mt-3 text-step--1 text-state-weak">
          That did not go through. Try again, or rewrite the modules one at a
          time from their own pages.
        </p>
      ) : null}
    </section>
  );
}
