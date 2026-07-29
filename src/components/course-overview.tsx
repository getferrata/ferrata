import Link from "next/link";
import type { CourseBundle } from "@/lib/course/query";
import { renderMarkdown } from "@/lib/md";
import { VerifyCourse } from "@/components/verify-course";
import { getDueSummary } from "@/lib/review/due";
import { StateChip } from "./state-chip";
import { ExportButton } from "./export-button";
import { AssessmentToggle } from "./assessment-toggle";
import { AddMaterial } from "./add-material";
import { ProposedUpdates, type ProposalView } from "./proposed-updates";
import { DeleteCourse } from "./delete-course";
import { CourseReceipt } from "./course-receipt";
import { ConceptGraph } from "./concept-graph";
import { FerrataMark } from "./brand";

const KIND_LABEL: Record<string, string> = {
  method: "method",
  meta: "meta",
  concept: "",
};

/** The course overview: the honest front matter, the plan, and the route. */
export function CourseOverview({
  bundle,
  userId,
  verifiedByName = null,
  canVerify = false,
  canEdit = false,
  proposals = [],
  analysing = false,
  deadline,
  resume,
}: {
  bundle: CourseBundle;
  userId?: string;
  verifiedByName?: string | null;
  canVerify?: boolean;
  /** Owner examiner: may change how tests count and rework the course. */
  canEdit?: boolean;
  /** Pending proposals from newly added material (owner examiner only). */
  proposals?: ProposalView[];
  /** True while a propose_updates job for this course is queued or running. */
  analysing?: boolean;
  deadline?: number | null;
  /** A student's resume bookmark: the last module they opened. */
  resume?: { moduleId: string; title: string } | null;
}) {
  const { course, modules, cuts, sources, edges } = bundle;
  const okSources = sources.filter((s) => s.status === "ok");
  const due = getDueSummary(course.id, Date.now(), userId);
  const canReview = due.due + due.newCount > 0;
  const totalMinutes = modules.reduce(
    (s, m) => s + m.concept.estimatedMinutes,
    0,
  );
  // Pace, when a deadline is set: how much is left and what that means per day.
  const daysLeft =
    deadline != null
      ? Math.ceil((deadline - Date.now()) / (24 * 60 * 60 * 1000))
      : null;
  const perDayMinutes =
    daysLeft != null && daysLeft > 0
      ? Math.round(totalMinutes / daysLeft)
      : null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      {/* Front matter */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-step--1 uppercase tracking-[0.08em] text-text-muted">
          {course.domain ?? "route"} · {course.lang}
        </p>
        {course.origin === "imported" ? (
          <VerifyCourse
            courseId={course.id}
            verifiedByName={verifiedByName}
            canVerify={canVerify}
          />
        ) : null}
      </div>
      <h1 className="mt-2 max-w-measure font-serif text-step-4 leading-[1.1] tracking-tight">
        {course.title}
      </h1>
      {course.objective ? (
        <p className="mt-5 max-w-measure font-serif text-step-1 text-text">
          {course.objective}
        </p>
      ) : null}
      {course.concretenessRule ? (
        <p className="mt-5 max-w-measure border-l-[3px] border-accent pl-4 font-serif text-step-0 italic text-text-muted">
          <span className="not-italic font-semibold text-text">
            Rule number one.{" "}
          </span>
          {stripMd(course.concretenessRule)}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-step--1 text-text-muted">
        {course.startLevel ? <span>Starting level: {course.startLevel}</span> : null}
        <span>{modules.length} modules</span>
        <span>~{Math.round(totalMinutes / 60)} h of study</span>
        {deadline ? (
          <span className="text-text">
            Deadline: {new Date(deadline).toLocaleDateString("it-IT")}
          </span>
        ) : null}
        {course.budgetMinutes ? (
          <span>Time budget: {Math.round(course.budgetMinutes / 60)} h</span>
        ) : null}
      </div>

      {resume ? (
        <Link
          href={`/courses/${course.id}/m/${resume.moduleId}`}
          className="mt-8 flex items-center gap-4 rounded-lg border border-border bg-bg-subtle px-5 py-4 transition hover:border-accent"
        >
          <FerrataMark className="h-8 w-8 shrink-0 text-text" />
          <span className="min-w-0">
            <span className="block text-step--1 uppercase tracking-[0.1em] text-text-muted">
              Resume where you left off
            </span>
            <span className="block truncate font-serif text-step-1 text-text">
              {resume.title}
            </span>
          </span>
          <span aria-hidden className="ml-auto font-mono text-text-muted">
            →
          </span>
        </Link>
      ) : null}

      {edges.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-4 font-serif text-step-2">Prerequisite map</h2>
          <div className="rounded border border-border bg-bg-subtle p-4">
            <ConceptGraph
              nodes={modules.map((m) => ({
                id: m.concept.id,
                title: m.concept.title,
                href: m.module
                  ? `/courses/${course.id}/m/${m.module.id}`
                  : undefined,
              }))}
              edges={edges}
            />
          </div>
        </section>
      ) : null}

      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
        {/* The route */}
        <section aria-label="The route">
          <h2 className="mb-6 font-serif text-step-2">The route</h2>
          <ol className="relative border-l border-border pl-8">
            {modules.map((m, i) => {
              const kind = KIND_LABEL[m.module?.kind ?? "concept"];
              const href = m.module ? `/courses/${course.id}/m/${m.module.id}` : null;
              const Row = (
                <>
                  <span
                    aria-hidden
                    className="absolute -left-[7px] mt-2 h-3 w-3 rounded-full border-2 border-accent bg-bg"
                  />
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="font-serif text-step-1 leading-snug text-text">
                      <span className="mr-2 text-text-muted">
                        {String(i).padStart(2, "0")}
                      </span>
                      {m.concept.title}
                      {kind ? (
                        <span className="ml-2 align-middle text-step--1 uppercase tracking-wide text-text-muted">
                          · {kind}
                        </span>
                      ) : null}
                    </h3>
                    <span className="shrink-0 text-step--1 text-text-muted">
                      ~{m.concept.estimatedMinutes}′
                    </span>
                  </div>
                  <p className="mt-1 max-w-measure text-step-0 text-text-muted">
                    {m.concept.summary}
                  </p>
                  <div className="mt-2 flex items-center gap-4">
                    {m.module ? (
                      <>
                        <StateChip state="untested" />
                        {m.questions.length > 0 ? (
                          <span className="text-step--1 text-text-muted">
                            {m.questions.length}{" "}
                            {m.questions.length === 1 ? "anchor" : "anchors"}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-step--1 italic text-state-doubt">
                        module not generated
                      </span>
                    )}
                  </div>
                </>
              );
              return (
                <li key={m.concept.id} className="relative pb-8">
                  {href ? (
                    <Link
                      href={href}
                      className="block rounded transition hover:opacity-80"
                    >
                      {Row}
                    </Link>
                  ) : (
                    Row
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {/* Side rail: pace, schedule, cuts, material. Collapsible so a long
            schedule never buries what sits under it, and sticky so it stays
            with you while you read the route. */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <section className="rounded border border-accent bg-bg-subtle p-4">
            <h2 className="mb-3 text-step--1 uppercase tracking-wide text-text-muted">
              Your pace
            </h2>
            <dl className="flex flex-col gap-2 text-step--1">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-text-muted">To read</dt>
                <dd className="text-text">
                  {modules.length} modules, ~{Math.round(totalMinutes / 60)} h
                </dd>
              </div>
              {daysLeft !== null ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-text-muted">Time left</dt>
                  <dd className={daysLeft <= 3 ? "text-danger" : "text-text"}>
                    {daysLeft > 0
                      ? `${daysLeft} ${daysLeft === 1 ? "day" : "days"}`
                      : "past the deadline"}
                  </dd>
                </div>
              ) : null}
              {perDayMinutes !== null ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-text-muted">That is</dt>
                  <dd className="text-text">~{perDayMinutes} min a day</dd>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-text-muted">Due to review</dt>
                <dd className={canReview ? "text-accent" : "text-text-muted"}>
                  {due.due + due.newCount === 0
                    ? "nothing right now"
                    : `${due.due + due.newCount} ${due.due + due.newCount === 1 ? "question" : "questions"}`}
                </dd>
              </div>
            </dl>
            {canReview ? (
              <Link
                href={`/courses/${course.id}/review`}
                className="mt-3 block rounded bg-accent px-3 py-2 text-center text-step--1 font-semibold text-accent-contrast transition hover:opacity-90"
              >
                Start a review session
              </Link>
            ) : null}
          </section>

          <details className="rounded border border-border p-4 [&[open]_.marker]:rotate-90">
            <summary className="flex cursor-pointer items-center gap-2 text-step--1 uppercase tracking-wide text-text-muted marker:content-['']">
              <span className="marker font-mono transition-transform">
                &rsaquo;
              </span>
              What you won&rsquo;t study
              {cuts.length > 0 ? (
                <span className="ml-auto font-mono">{cuts.length}</span>
              ) : null}
            </summary>
            <div className="mt-3">
            {cuts.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {cuts.map((c) => (
                  <li key={c.id} className="text-step--1">
                    <span className="text-text line-through decoration-text-muted">
                      {c.title}
                    </span>
                    <span className="mt-0.5 block text-text-muted">
                      {c.reason}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-step--1 text-text-muted">
                No hard cuts: the priorities and the 80/20 schedule decide how
                much time goes to each module.
              </p>
            )}
            </div>
          </details>

          {sources.length > 0 ? (
            // Open by default when a source failed: a link that could not be
            // read is something to act on, not something to go looking for.
            <details
              open={sources.some((s) => s.status !== "ok")}
              className="rounded border border-border p-4 [&[open]_.marker]:rotate-90"
            >
              <summary className="flex cursor-pointer items-center gap-2 text-step--1 uppercase tracking-wide text-text-muted marker:content-['']">
                <span className="marker font-mono transition-transform">
                  &rsaquo;
                </span>
                Material
                <span
                  className={
                    "ml-auto font-mono " +
                    (okSources.length < sources.length ? "text-danger" : "")
                  }
                >
                  {okSources.length}/{sources.length}
                </span>
              </summary>
              <p className="mb-3 mt-3 text-step--1 text-text-muted">
                The course is anchored to these sources and cites them in the
                modules.
              </p>
              <ul className="flex flex-col gap-2">
                {sources.map((s) => {
                  const { redactions, protectedValues } = parseSensitivity(
                    s.sensitivityJson,
                  );
                  return (
                    <li key={s.id} className="text-step--1">
                      <span className="text-text">{s.name}</span>
                      {s.status === "ok" ? (
                        <span className="ml-2 text-text-muted">
                          {(s.bytes / 1024).toFixed(0)} KB
                        </span>
                      ) : (
                        <span className="ml-2 text-danger">
                          not read{s.error ? `: ${s.error}` : ""}
                          {s.errorKind === "auth" ? (
                            <>
                              {" "}
                              <Link
                                href="/settings#connections"
                                className="underline underline-offset-2"
                              >
                                Add site credentials
                              </Link>
                            </>
                          ) : null}
                        </span>
                      )}
                      {redactions > 0 ? (
                        <span
                          className="ml-2 rounded border border-state-doubt px-1.5 py-0.5 text-state-doubt"
                          title="Secrets detected and removed by Contextia before generating"
                        >
                          {redactions} secret{redactions === 1 ? "" : "s"} removed
                        </span>
                      ) : null}
                      {protectedValues > 0 ? (
                        <span
                          className="cxt-badge ml-2 rounded px-1.5 py-0.5"
                          title="Operational values (IPs, hosts) hidden from the AI and restored into the course by Contextia"
                        >
                          {protectedValues} protected
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-step--1 text-text-muted">
                Material passes through Contextia locally: credentials and
                sensitive data are removed before the model reads them.
              </p>
            </details>
          ) : null}

          <section className="rounded border border-border p-4">
            <h2 className="mb-3 text-step--1 uppercase tracking-wide text-text-muted">
              Tools
            </h2>
            <div className="flex flex-col gap-3">
              <Link
                href={`/courses/${course.id}/dashboard`}
                className="text-step-0 text-accent underline underline-offset-2"
              >
                What you actually know →
              </Link>
              {/* Export carries the answer keys and delete is destructive: both
                  are the owner's, so students never see (or hit) them. */}
              {canEdit ? (
                <>
                  <ExportButton courseId={course.id} kind="package" />
                  <ExportButton courseId={course.id} kind="obsidian" />
                  <DeleteCourse courseId={course.id} />
                </>
              ) : null}
            </div>
          </section>

          {canEdit ? (
            <section className="rounded border border-border p-4">
              <h2 className="mb-3 text-step--1 uppercase tracking-wide text-text-muted">
                Author
              </h2>
              <div className="flex flex-col gap-6">
                <AssessmentToggle
                  courseId={course.id}
                  mode={course.assessmentMode}
                />
                <AddMaterial courseId={course.id} />
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      {canEdit ? (
        <ProposedUpdates
          courseId={course.id}
          proposals={proposals}
          analysing={analysing}
        />
      ) : null}

      {course.scheduleMd ? (
        <details
          open
          className="mt-12 rounded border border-border bg-bg-subtle p-5 [&[open]_.marker]:rotate-90"
        >
          <summary className="flex cursor-pointer items-center gap-2 text-step--1 uppercase tracking-wide text-text-muted marker:content-['']">
            <span className="marker font-mono transition-transform">&rsaquo;</span>
            Schedule
          </summary>
          <div
            className="reading-prose mt-4 overflow-x-auto"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(course.scheduleMd),
            }}
          />
        </details>
      ) : null}

      {course.glossaryMd ? (
        <p className="mt-12 text-step--1 text-text-muted">
          At the end there&rsquo;s a{" "}
          <Link
            href={`/courses/${course.id}/glossary`}
            className="text-accent underline underline-offset-2"
          >
            quick glossary
          </Link>{" "}
          to reread before you start.
        </p>
      ) : null}
    </main>
  );
}

/** Strip the few markdown emphasis markers we inline into plain text. */
function stripMd(s: string): string {
  return s.replace(/\*\*/g, "").replace(/\*/g, "");
}

/** Contextia counts for a source: secrets removed, and infra values protected. */
function parseSensitivity(sensitivityJson: string | null): {
  redactions: number;
  protectedValues: number;
} {
  if (!sensitivityJson) return { redactions: 0, protectedValues: 0 };
  try {
    const v = JSON.parse(sensitivityJson) as {
      redactions?: unknown;
      protectedValues?: unknown;
    };
    return {
      redactions: typeof v.redactions === "number" ? v.redactions : 0,
      protectedValues:
        typeof v.protectedValues === "number" ? v.protectedValues : 0,
    };
  } catch {
    return { redactions: 0, protectedValues: 0 };
  }
}
