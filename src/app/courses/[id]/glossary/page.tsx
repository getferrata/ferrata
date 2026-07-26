import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourseBundle } from "@/lib/course/query";
import { renderMarkdown } from "@/lib/md";
import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth/session";
import { canSeeCourse } from "@/lib/course/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Glossary" };

export default async function GlossaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // A course id is guessable, so a session alone is not enough: this has to
  // be a course this person owns or was assigned.
  const viewer = await requireUser();
  if (!canSeeCourse(id, { userId: viewer.id, role: viewer.role })) notFound();
  const bundle = getCourseBundle(id);
  if (!bundle || !bundle.course.glossaryMd) notFound();

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
        <article
          className="reading-prose"
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(bundle.course.glossaryMd),
          }}
        />
      </main>
    </>
  );
}
