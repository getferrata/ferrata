import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { requireExaminer } from "@/lib/auth/session";
import { getRoster, type StudentProgress } from "@/lib/course/roster";
import { plainText } from "@/lib/text";
import { SiteHeader } from "@/components/site-header";
import { EnrollForm } from "@/components/enroll-form";
import { InviteButton } from "@/components/invite-button";
import { RemoveStudent } from "@/components/remove-student";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Students" };

function pct(x: number | null): string {
  return x === null ? "-" : `${Math.round(x * 100)}%`;
}
function retColor(x: number | null): string {
  if (x === null) return "var(--text-muted)";
  if (x >= 0.8) return "var(--state-solid)";
  if (x >= 0.5) return "var(--state-doubt)";
  return "var(--danger)";
}

export default async function ExaminerPage() {
  const me = await requireExaminer();
  const owned = db
    .select()
    .from(courses)
    .where(eq(courses.ownerId, me.id))
    .orderBy(desc(courses.createdAt))
    .all();

  return (
    <>
      <SiteHeader
        right={
          <Link
            href="/crea"
            className="tap text-step--1 text-text-muted underline underline-offset-2 hover:text-text"
          >
            New route
          </Link>
        }
      />
      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="font-serif text-step-3 leading-tight">
          How your students are doing
        </h1>
        <p className="mt-2 max-w-measure text-step-0 text-text-muted">
          Not the percentage of the course completed: how much they actually
          retain, and where they&rsquo;re &ldquo;sure and wrong&rdquo;. You see
          the onboarding route, not their individual answers.
        </p>
        <Link
          href="/examiner/users"
          className="tap mt-3 inline-block text-step--1 text-accent underline underline-offset-2"
        >
          Manage users →
        </Link>

        {owned.length === 0 ? (
          <div className="mt-8 rounded border border-border bg-bg-subtle p-6">
            <p className="font-serif text-step-1 text-text">
              You haven&rsquo;t created a course yet.
            </p>
            <p className="mt-2 text-step-0 text-text-muted">
              Create an onboarding route from your material, then assign students
              here.
            </p>
            <Link
              href="/crea"
              className="mt-4 inline-block text-step-0 text-accent underline underline-offset-2"
            >
              Create a route
            </Link>
          </div>
        ) : (
          <div className="mt-10 flex flex-col gap-12">
            {owned.map((c) => (
              <section key={c.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-serif text-step-2">
                    <Link
                      href={`/courses/${c.id}`}
                      className="underline decoration-border underline-offset-4 hover:decoration-text"
                    >
                      {plainText(c.title)}
                    </Link>
                  </h2>
                  <span className="text-step--1 text-text-muted">
                    {c.assessmentMode === "assessed" ? "assessed · " : ""}
                    {c.status === "ready" ? "ready" : c.status}
                  </span>
                </div>
                <Roster courseId={c.id} rows={getRoster(c.id)} />
                <EnrollForm courseId={c.id} />
                <InviteButton courseId={c.id} />
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function Roster({
  courseId,
  rows,
}: {
  courseId: string;
  rows: StudentProgress[];
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-4 text-step--1 text-text-muted">
        No students assigned. Add someone below.
      </p>
    );
  }
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-step--1">
        <thead>
          <tr className="border-b border-border text-left text-text-muted">
            <th className="py-2 pr-4 font-medium">Student</th>
            <th className="py-2 pr-4 font-medium">Readiness</th>
            <th className="py-2 pr-4 font-medium">Tested</th>
            <th className="py-2 pr-4 font-medium">Sure and wrong</th>
            <th className="py-2 pr-4 font-medium">Deadline</th>
            <th className="py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.userId} className="border-b border-border">
              <td className="py-2.5 pr-4">
                <Link
                  href={`/examiner/student/${courseId}/${s.userId}`}
                  className="text-text underline decoration-border underline-offset-2 hover:decoration-text"
                >
                  {s.name}
                </Link>
                <span className="ml-2 text-text-muted">{s.email}</span>
              </td>
              <td className="py-2.5 pr-4">
                <span style={{ color: retColor(s.retention) }}>
                  {pct(s.retention)}
                </span>
              </td>
              <td className="py-2.5 pr-4 text-text-muted">
                {s.answered}/{s.total}
              </td>
              <td className="py-2.5 pr-4">
                {s.sureWrong > 0 ? (
                  <span className="text-danger">{s.sureWrong}</span>
                ) : (
                  <span className="text-text-muted">0</span>
                )}
              </td>
              <td className="py-2.5 pr-4 text-text-muted">
                {s.deadline
                  ? new Date(s.deadline).toLocaleDateString("it-IT")
                  : "-"}
              </td>
              <td className="py-2.5 text-right">
                <RemoveStudent courseId={courseId} userId={s.userId} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
