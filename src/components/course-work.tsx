"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CourseWork } from "@/lib/course/work";

// Same cadence as the other live panels. The ceiling is higher because a full
// build is the longest thing on this page, and a page that stops refreshing
// halfway through one is the bug this is here to fix.
const POLL_MS = 2500;
const MAX_POLLS = 480;

const LABEL: Record<string, string> = {
  generate_course: "Building the course",
  interview_questions: "Writing the interview",
  intake: "Reading your material",
  build_graph: "Ordering the concepts",
  regenerate_module: "Rewriting a module",
  propose_updates: "Reading the new material",
  check_sources: "Re-reading the sources",
};

function label(type: string): string {
  return LABEL[type] ?? type.replace(/_/g, " ");
}

function ago(from: number, at: number): string {
  const minutes = Math.floor((at - from) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "a minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "an hour ago" : `${hours} hours ago`;
}

/**
 * What the worker is doing for this course, and what it gave up on.
 *
 * The page underneath is a server snapshot, so a click that queued work leaves
 * it looking exactly as it did before. This says which of the three things
 * happened, and keeps saying it: while anything is queued or running it asks
 * the server for a fresh render, so the moment the rewrite lands the route
 * below updates in place without the author reloading and guessing.
 */
export function CourseWorkPanel({ work }: { work: CourseWork }) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  const live = work.active.length > 0;

  useEffect(() => {
    // Read the clock on the client only. Rendering "3 minutes ago" on the
    // server and again here would disagree by the time in between, which
    // React reports as a hydration mismatch.
    setNow(Date.now());
    if (!live) return;
    let n = 0;
    const t = setInterval(() => {
      setNow(Date.now());
      n += 1;
      if (n > MAX_POLLS) {
        clearInterval(t);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [live, router, work.active.length, work.failed.length]);

  if (!live && work.failed.length === 0) return null;

  return (
    <section
      aria-label="Work on this course"
      role={live ? "status" : undefined}
      className="mt-8 rounded border border-accent bg-bg-subtle p-4"
    >
      <h2 className="text-step--1 uppercase tracking-wide text-text-muted">
        {live ? "Working on it" : "Something did not finish"}
      </h2>

      {live ? (
        <ul className="mt-3 flex flex-col gap-2">
          {work.active.map((a, i) => (
            <li
              key={`${a.type}-${a.conceptId ?? i}`}
              className="flex flex-wrap items-baseline gap-x-3 text-step--1"
            >
              <span className="text-text">{label(a.type)}</span>
              <span className="text-text-muted">
                {a.status === "queued"
                  ? "waiting its turn"
                  : now === null
                    ? "running"
                    : `running since ${ago(a.since, now)}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {work.failed.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-3">
          {work.failed.map((f) => (
            <li key={f.type} className="text-step--1">
              <span className="text-danger">{label(f.type)} stopped</span>
              <span className="text-text-muted">
                {now === null ? "" : ` ${ago(f.at, now)}`}
              </span>
              <span className="mt-1 block break-words text-text-muted">
                {f.error}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {live ? (
        <p className="mt-3 text-step--1 text-text-muted">
          This page updates on its own. You can leave and come back.
        </p>
      ) : (
        <p className="mt-3 text-step--1 text-text-muted">
          The course itself is untouched. Ask for it again once the reason above
          is dealt with.
        </p>
      )}
    </section>
  );
}
