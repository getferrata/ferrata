import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDashboard, type ConceptRetention } from "@/lib/course/dashboard";
import { getCourseAggregate, type CourseAggregate } from "@/lib/course/aggregate";
import { requireUser } from "@/lib/auth/session";
import { canSeeCourse } from "@/lib/course/access";
import { SiteHeader } from "@/components/site-header";
import { KnowledgeMatrix } from "@/components/knowledge-matrix";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "What you actually know" };

function pct(x: number | null): string {
  return x === null ? "-" : `${Math.round(x * 100)}%`;
}

function retentionColor(x: number | null): string {
  if (x === null) return "var(--state-untested)";
  if (x >= 0.8) return "var(--state-solid)";
  if (x >= 0.5) return "var(--state-doubt)";
  return "var(--danger)";
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  // Being signed in is not the question: this has to be a course this
  // person owns or was assigned. Ids are guessable.
  if (!canSeeCourse(id, { userId: user.id, role: user.role })) notFound();

  // An examiner gets the class, not a class-shaped version of the student view.
  // Dropping the student filter from the student dashboard does not average
  // anything: it yields the latest answer to each question by whoever answered
  // it last, a figure that moves when any one person reviews and describes
  // nobody. The examiner's question is "how is each of them doing", so that is
  // what the page answers, with the roster median as the one summary number.
  if (user.role === "examiner") {
    return <ExaminerView id={id} agg={getCourseAggregate(id, new Date())} />;
  }

  const d = getDashboard(id, new Date(), user.id);
  if (!d) notFound();

  return (
    <>
      <SiteHeader
        right={
          <Link
            href={`/courses/${id}`}
            className="text-step--1 text-text-muted underline underline-offset-2 hover:text-text"
          >
            The route
          </Link>
        }
      />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="font-serif text-step-3 leading-tight">
          What you actually know
        </h1>

        {/* The honest metric */}
        <section className="mt-8 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
          <div
            className="flex h-32 w-32 flex-col items-center justify-center rounded-full border-4"
            style={{ borderColor: retentionColor(d.courseRetention) }}
          >
            <span className="font-serif text-step-4 leading-none">
              {pct(d.courseRetention)}
            </span>
            <span className="mt-1 text-step--1 text-text-muted">readiness</span>
          </div>
          <p className="max-w-measure font-serif text-step-1 text-text-muted">
            {d.courseRetention === null
              ? "Nothing has been tested yet. Readiness isn't something you declare, it's measured: answer the module tests and it will show up here."
              : "The share of concepts you'd still know if quizzed right now, estimated from your review state. It falls on its own if you don't review. It isn't a bar that only ever goes up."}
          </p>
        </section>

        <p className="mt-4 text-step--1 text-text-muted">
          {d.testedCount}/{d.totalQuestions} questions attempted ·{" "}
          {d.untestedCount} still to test
          {d.explainedCount > 0 ? (
            <>
              {" "}
              · {d.explainedCount}{" "}
              {d.explainedCount === 1 ? "concept" : "concepts"} explained in
              your own words
            </>
          ) : null}
        </p>

        {/* Where the evidence came from. A figure built entirely out of
            self-grading measures honesty as much as knowledge, and whoever
            reads it is entitled to know which they are looking at. */}
        {d.assessmentMode === "assessed" ? (
          <p className="mt-2 text-step--1 text-text-muted">
            Assessed course: only answers the system can check count here
            {d.practiceQuestions > 0
              ? `. The other ${d.practiceQuestions} questions stay as practice`
              : ""}
            .
          </p>
        ) : d.testedCount > 0 ? (
          <p className="mt-2 text-step--1 text-text-muted">
            {d.evidence.system + d.evidence.model === 0
              ? "Every answer was graded by you. This is practice, not a measurement."
              : d.evidence.self === 0
                ? "Every answer was checked against the stored one."
                : `${d.evidence.system + d.evidence.model} of ${d.testedCount} checked against the stored answer; the rest you graded yourself.`}
          </p>
        ) : null}

        <KnowledgeMatrix m={d.matrix} />

        {/* What you don't know */}
        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          <section>
            <h2 className="mb-4 font-serif text-step-2">Where you&rsquo;re weak</h2>
            {d.weakest.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {d.weakest.map((c) => (
                  <RetentionRow key={c.conceptId} c={c} />
                ))}
              </ul>
            ) : (
              <p className="text-step--1 text-text-muted">
                Nothing to show yet: test yourself on a few modules.
              </p>
            )}
          </section>

          <section>
            <h2 className="mb-4 font-serif text-step-2">
              In your own words
            </h2>
            <p className="mb-3 max-w-measure text-step--1 text-text-muted">
              Concepts you explained back, and whether the explanation held.
            </p>
            {d.concepts.some((c) => c.explained !== null) ? (
              <ul className="flex flex-col gap-2">
                {d.concepts
                  .filter((c) => c.explained !== null)
                  .map((c) => (
                    <li
                      key={c.conceptId}
                      className="flex items-baseline justify-between gap-3 rounded border border-border px-3 py-2"
                    >
                      <span className="text-step-0 text-text">{c.title}</span>
                      {c.explained === "complete" ? (
                        <span
                          className="text-step--1"
                          style={{ color: "var(--state-solid)" }}
                        >
                          held up &#10003;
                        </span>
                      ) : (
                        <span className="text-step--1 text-text-muted">
                          explained, with a gap
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-step--1 text-text-muted">
                Not yet: open a module and explain it in your own words.
              </p>
            )}
          </section>

          <section>
            <h2 className="mb-4 font-serif text-step-2">
              Sure and wrong
            </h2>
            <p className="mb-3 max-w-measure text-step--1 text-text-muted">
              The mistakes you don&rsquo;t know you&rsquo;re making. They come back first and most often.
            </p>
            {d.sureWrong.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {d.sureWrong.map((s) => (
                  <li
                    key={s.questionId}
                    className="rounded border border-danger px-3 py-2"
                  >
                    <p className="text-step--1 text-danger">
                      {s.conceptTitle}
                    </p>
                    <p className="text-step-0 text-text">{s.prompt}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-step--1 text-text-muted">
                None so far. It&rsquo;s the cell that matters most.
              </p>
            )}
          </section>
        </div>

        {/* Explicit cut list */}
        {d.cuts.length > 0 ? (
          <section className="mt-12">
            <h2 className="mb-4 font-serif text-step-2">
              What you chose not to study
            </h2>
            <ul className="flex flex-col gap-2">
              {d.cuts.map((c) => (
                <li key={c.id} className="text-step--1">
                  <span className="text-text line-through decoration-text-muted">
                    {c.title}
                  </span>
                  <span className="ml-2 text-text-muted">{c.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}

/**
 * The class, per person. No single circle: a course figure that averages people
 * hides the one who is not ready, and that is the person the page exists for.
 */
function ExaminerView({ id, agg }: { id: string; agg: CourseAggregate }) {
  return (
    <>
      <SiteHeader
        right={
          <Link
            href={`/courses/${id}`}
            className="text-step--1 text-text-muted underline underline-offset-2 hover:text-text"
          >
            The route
          </Link>
        }
      />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="font-serif text-step-3 leading-tight">
          What the class actually knows
        </h1>
        <p className="mt-2 max-w-measure text-step-0 text-text-muted">
          {agg.courseTitle}
        </p>
        {agg.assessed ? (
          <p className="mt-2 max-w-measure text-step--1 text-text-muted">
            Assessed course: these figures count only answers the system
            checked, never a student&rsquo;s own grading of themselves.
          </p>
        ) : null}

        {agg.students.length === 0 ? (
          <p className="mt-8 max-w-measure text-step-0 text-text-muted">
            Nobody is assigned to this course yet. Invite someone from the
            examiner page and their readiness will show up here.
          </p>
        ) : (
          <>
            <section className="mt-8 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
              <div
                className="flex h-32 w-32 flex-col items-center justify-center rounded-full border-4"
                style={{ borderColor: retentionColor(agg.medianRetention) }}
              >
                <span className="font-serif text-step-4 leading-none">
                  {pct(agg.medianRetention)}
                </span>
                <span className="mt-1 text-step--1 text-text-muted">median</span>
              </div>
              <p className="max-w-measure font-serif text-step-1 text-text-muted">
                {agg.medianRetention === null
                  ? "Nobody has been measured yet. Readiness appears here once students start answering."
                  : `Half of the ${agg.measuredStudents} measured ${agg.measuredStudents === 1 ? "student is" : "students are"} at least this ready. It is a median, not an average: one person who has not started cannot drag the class down, and one who is ahead cannot cover for the rest.`}
              </p>
            </section>

            <section className="mt-10">
              <h2 className="mb-4 font-serif text-step-2">Person by person</h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-step--1">
                  <thead>
                    <tr className="border-b border-border text-left text-text-muted">
                      <th className="py-2 pr-4 font-medium">Student</th>
                      <th className="py-2 pr-4 font-medium">Readiness</th>
                      <th className="py-2 pr-4 font-medium">Tested</th>
                      <th className="py-2 font-medium">Sure and wrong</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agg.students.map((s) => (
                      <tr key={s.userId} className="border-b border-border">
                        <td className="py-2.5 pr-4">
                          <Link
                            href={`/examiner/student/${id}/${s.userId}`}
                            className="text-text underline decoration-border underline-offset-4 hover:decoration-text"
                          >
                            {s.name}
                          </Link>
                        </td>
                        <td
                          className="py-2.5 pr-4 font-mono"
                          style={{ color: retentionColor(s.retention) }}
                        >
                          {pct(s.retention)}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-text-muted">
                          {s.answered}/{s.total}
                        </td>
                        <td
                          className="py-2.5 font-mono"
                          style={{
                            color:
                              s.sureWrong > 0 ? "var(--danger)" : undefined,
                          }}
                        >
                          {s.sureWrong}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {agg.weakForMany.length > 0 ? (
              <section className="mt-12">
                <h2 className="mb-2 font-serif text-step-2">
                  Weak for most of the class
                </h2>
                <p className="mb-4 max-w-measure text-step--1 text-text-muted">
                  One person struggling with a concept is their gap. Half the
                  class struggling with it is the module&rsquo;s, and worth your
                  time to rewrite.
                </p>
                <ul className="flex flex-col gap-2">
                  {agg.weakForMany.map((w) => (
                    <li
                      key={w.conceptId}
                      className="flex items-baseline justify-between gap-3 rounded border border-border px-3 py-2"
                    >
                      <span className="text-step-0 text-text">{w.title}</span>
                      <span className="text-step--1 text-text-muted">
                        weak for {w.weakStudents} of {agg.measuredStudents}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}

function RetentionRow({ c }: { c: ConceptRetention }) {
  const value = c.retention ?? 0;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-serif text-step-0 text-text">
          {c.title}
          {c.explained === "complete" ? (
            <span
              className="ml-2 text-step--1"
              style={{ color: "var(--state-solid)" }}
              title="Explained in your own words, and it held up"
            >
              explained &#10003;
            </span>
          ) : c.explained === "gappy" ? (
            <span
              className="ml-2 text-step--1 text-text-muted"
              title="Explained in your own words, with a gap"
            >
              explained, with a gap
            </span>
          ) : null}
        </span>
        <span
          className="text-step--1"
          style={{ color: retentionColor(c.retention) }}
        >
          {pct(c.retention)}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-bg-subtle">
        <div
          className="h-full rounded"
          style={{
            width: `${Math.round(value * 100)}%`,
            backgroundColor: retentionColor(c.retention),
          }}
        />
      </div>
    </li>
  );
}
