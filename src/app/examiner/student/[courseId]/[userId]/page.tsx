import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, users } from "@/db/schema";
import { requireExaminer } from "@/lib/auth/session";
import { getDashboard } from "@/lib/course/dashboard";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Student" };

function pct(x: number | null): string {
  return x === null ? "-" : `${Math.round(x * 100)}%`;
}
function retColor(x: number | null): string {
  if (x === null) return "var(--text-muted)";
  if (x >= 0.8) return "var(--state-solid)";
  if (x >= 0.5) return "var(--state-doubt)";
  return "var(--danger)";
}

export default async function StudentDrilldown({
  params,
}: {
  params: Promise<{ courseId: string; userId: string }>;
}) {
  const { courseId, userId } = await params;
  const me = await requireExaminer();

  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) notFound();
  if (course.ownerId && course.ownerId !== me.id) notFound();

  const student = db.select().from(users).where(eq(users.id, userId)).get();
  if (!student) notFound();

  const d = getDashboard(courseId, new Date(), userId);
  if (!d) notFound();

  return (
    <>
      <SiteHeader
        right={
          <Link
            href="/examiner"
            className="text-step--1 text-text-muted underline underline-offset-2 hover:text-text"
          >
            All students
          </Link>
        }
      />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-step--1 uppercase tracking-[0.08em] text-text-muted">
          {d.courseTitle}
        </p>
        <h1 className="mt-2 font-serif text-step-3 leading-tight">
          {student.name}
        </h1>
        <p className="mt-1 text-step--1 text-text-muted">{student.email}</p>

        <div className="mt-8 flex flex-wrap gap-x-10 gap-y-3">
          <Stat label="Readiness" value={pct(d.courseRetention)} color={retColor(d.courseRetention)} />
          <Stat label="Tested" value={`${d.testedCount}/${d.totalQuestions}`} />
          <Stat label="Sure and wrong" value={String(d.sureWrong.length)} color={d.sureWrong.length ? "var(--danger)" : undefined} />
        </div>

        <section className="mt-12">
          <h2 className="font-serif text-step-2">Where they&rsquo;re weak</h2>
          {d.weakest.length === 0 ? (
            <p className="mt-2 text-step-0 text-text-muted">
              Nothing to show yet: they haven&rsquo;t tested enough.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {d.weakest.map((c) => (
                <li
                  key={c.conceptId}
                  className="flex items-baseline justify-between gap-4 border-b border-border pb-2"
                >
                  <span className="text-text">{c.title}</span>
                  <span style={{ color: retColor(c.retention) }}>
                    {pct(c.retention)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {d.sureWrong.length > 0 ? (
          <section className="mt-12">
            <h2 className="font-serif text-step-2">Sure and wrong</h2>
            <p className="mt-2 max-w-measure text-step-0 text-text-muted">
              The mistakes they don&rsquo;t know they&rsquo;re making: where
              they&rsquo;re sure but wrong.
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {d.sureWrong.map((s) => (
                <li
                  key={s.questionId}
                  className="rounded border border-danger p-4"
                >
                  <p className="text-step--1 uppercase tracking-wide text-text-muted">
                    {s.conceptTitle}
                  </p>
                  <p className="mt-1 font-serif text-step-0 text-text">
                    {s.prompt}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <p className="text-step--1 uppercase tracking-wide text-text-muted">
        {label}
      </p>
      <p className="mt-1 font-serif text-step-2" style={color ? { color } : undefined}>
        {value}
      </p>
    </div>
  );
}
