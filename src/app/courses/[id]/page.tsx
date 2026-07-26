import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { enrollments } from "@/db/schema";
import { getCourseBundle } from "@/lib/course/query";
import { CourseOverview } from "@/components/course-overview";
import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth/session";
import { canSeeCourse } from "@/lib/course/access";
import { studentDeadline } from "@/lib/course/invite";
import { PipelineProgress } from "./progress";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const bundle = getCourseBundle(id);
  return { title: bundle?.course.title ?? "Course" };
}

export default async function CoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  // Being signed in is not the question: this has to be a course this
  // person owns or was assigned. Ids are guessable.
  if (!canSeeCourse(id, { userId: user.id, role: user.role })) notFound();
  const bundle = getCourseBundle(id);
  if (!bundle) notFound();

  if (bundle.course.status === "ready") {
    let resume: { moduleId: string; title: string } | null = null;
    if (user.role === "student") {
      const enr = db
        .select({ lastModuleId: enrollments.lastModuleId })
        .from(enrollments)
        .where(
          and(eq(enrollments.courseId, id), eq(enrollments.userId, user.id)),
        )
        .get();
      if (enr?.lastModuleId) {
        const m = bundle.modules.find(
          (x) => x.module?.id === enr.lastModuleId,
        );
        if (m?.module) resume = { moduleId: m.module.id, title: m.concept.title };
      }
    }

    return (
      <>
        <SiteHeader
          right={
            <Link
              href={`/courses/${id}/dashboard`}
              className="text-step--1 text-text-muted underline underline-offset-2 hover:text-text"
            >
              What you know
            </Link>
          }
        />
        <CourseOverview
          bundle={bundle}
          userId={user.role === "student" ? user.id : undefined}
          deadline={
            user.role === "student" ? studentDeadline(id, user.id) : null
          }
          resume={resume}
        />
      </>
    );
  }

  // Still generating (or failed): show the live pipeline.
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-8 font-serif text-step-3 leading-tight">
          {bundle.course.title}
        </h1>
        <PipelineProgress id={id} />
      </main>
    </>
  );
}
