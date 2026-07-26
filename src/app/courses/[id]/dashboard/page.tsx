import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDashboard, type ConceptRetention } from "@/lib/course/dashboard";
import { requireUser } from "@/lib/auth/session";
import { canSeeCourse } from "@/lib/course/access";
import { SiteHeader } from "@/components/site-header";

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
  // Examiners see the course's aggregate; a student sees only their own answers.
  const d = getDashboard(id, new Date(), user.role === "student" ? user.id : undefined);
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
