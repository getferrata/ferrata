import type { Metadata } from "next";
import Link from "next/link";
import { listCourses, type CourseSummary } from "@/lib/course/list";
import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth/session";
import { llmSetupStatus } from "@/lib/llm/setup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My courses" };

const STATUS_LABEL: Record<string, string> = {
  interviewing: "preparing questions",
  interview: "waiting for your answers",
  intake: "generating",
  concept_review: "review the concepts",
  graphing: "generating",
  triaging: "generating",
  generating: "writing the modules",
  ready: "ready",
  failed: "failed",
};

export default async function CoursesPage() {
  const user = await requireUser();
  const courses = listCourses({ userId: user.id, role: user.role });
  const setup = user.role === "examiner" ? await llmSetupStatus() : null;

  return (
    <>
      <SiteHeader
        right={
          <Link
            href="/crea"
            className="text-step--1 text-text-muted underline underline-offset-2 hover:text-text"
          >
            New route
          </Link>
        }
      />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-serif text-step-3 leading-tight">My courses</h1>

        {setup && !setup.configured ? (
          <div className="mt-6 rounded-lg border border-accent bg-bg-subtle p-5">
            <p className="text-step--1 uppercase tracking-[0.1em] text-accent">
              First climb setup
            </p>
            <p className="mt-2 font-serif text-step-1 text-text">
              Connect a model, then everything works.
            </p>
            <p className="mt-1 max-w-measure text-step--1 text-text-muted">
              Ferrata generates courses with the AI provider you choose, on your
              own key or a local model. One setup, two minutes, and a full
              course costs about as much as a coffee, often less.
            </p>
            <Link
              href="/settings"
              className="mt-3 inline-block rounded bg-accent px-4 py-2 text-step--1 font-medium text-accent-contrast transition hover:opacity-90"
            >
              Set up the model
            </Link>
          </div>
        ) : null}

        {courses.length === 0 ? (
          <div className="mt-8 rounded border border-border bg-bg-subtle p-6">
            <p className="font-serif text-step-1 text-text">
              No routes yet.
            </p>
            <p className="mt-2 max-w-measure text-step-0 text-text-muted">
              Start from a topic and your material, or import a package.
            </p>
            <div className="mt-4 flex gap-4 text-step-0">
              <Link href="/crea" className="text-accent underline underline-offset-2">
                Create a route
              </Link>
              <Link
                href="/import"
                className="text-accent underline underline-offset-2"
              >
                Import a course
              </Link>
            </div>
          </div>
        ) : (
          <ul className="mt-8 flex flex-col gap-3">
            {courses.map((c) => (
              <CourseRow key={c.id} c={c} />
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function CourseRow({ c }: { c: CourseSummary }) {
  const ready = c.status === "ready";
  return (
    <li>
      <Link
        href={`/courses/${c.id}`}
        className="block rounded border border-border bg-surface p-4 transition hover:border-text-muted"
      >
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="min-w-0 truncate font-serif text-step-1 text-text">
            {c.title}
          </h2>
          <span
            className={
              "shrink-0 text-step--1 " +
              (ready
                ? "text-state-solid"
                : c.status === "failed"
                  ? "text-danger"
                  : "text-text-muted")
            }
          >
            {STATUS_LABEL[c.status] ?? c.status}
          </span>
        </div>
        <p className="mt-1 text-step--1 text-text-muted">
          {ready
            ? `${c.moduleCount} modules · ${c.testedCount}/${c.questionCount} questions attempted`
            : "building"}
          {c.origin === "imported" ? " · imported" : ""}
        </p>
      </Link>
    </li>
  );
}
