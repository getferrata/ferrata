import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getDueSession } from "@/lib/review/due";
import { requireUser } from "@/lib/auth/session";
import { canSeeCourse } from "@/lib/course/access";
import { SiteHeader } from "@/components/site-header";
import { ReviewSession } from "@/components/review-session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  // Being signed in is not the question: this has to be a course this
  // person owns or was assigned. Ids are guessable.
  if (!canSeeCourse(id, { userId: user.id, role: user.role })) notFound();
  const course = db.select().from(courses).where(eq(courses.id, id)).get();
  if (!course) notFound();

  const due = getDueSession(id, Date.now(), 20, user.id);

  return (
    <>
      <SiteHeader
        right={
          <Link
            href={`/courses/${id}`}
            className="tap text-step--1 text-text-muted underline underline-offset-2 hover:text-text"
          >
            The route
          </Link>
        }
      />
      <main className="mx-auto max-w-measure px-6 py-12">
        <h1 className="font-serif text-step-3 leading-tight">Review</h1>
        {due.length === 0 ? (
          <div className="mt-6">
            <p className="max-w-measure font-serif text-step-1 text-text-muted">
              Nothing due right now. Review comes when it&rsquo;s needed, not on
              every click. Come back when the cards are ripe, or study a new
              module.
            </p>
            <Link
              href={`/courses/${id}`}
              className="mt-6 inline-block text-step-0 text-accent underline underline-offset-2"
            >
              Back to the route
            </Link>
          </div>
        ) : (
          <ReviewSession
            courseId={id}
            questions={due.map((d) => ({
              questionId: d.questionId,
              conceptTitle: d.conceptTitle,
              prompt: d.prompt,
              expectedAnswer: d.expectedAnswer,
              sureWrong: d.sureWrong,
            }))}
          />
        )}
      </main>
    </>
  );
}
