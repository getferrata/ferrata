import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, enrollments } from "@/db/schema";
import type { UserRole } from "@/db/schema";

export interface Viewer {
  userId: string;
  role: UserRole;
}

/**
 * Can this person see this course at all?
 *
 * One rule, in one place, so an endpoint that hands out course content cannot
 * quietly use a laxer version of it than the listing page does. An examiner
 * sees the courses they own; a student sees the ones they were assigned.
 * Ownerless courses are the seed and pre-ownership ones, visible to everyone on
 * the install by design.
 */
export function canSeeCourse(courseId: string, viewer: Viewer): boolean {
  const course = db
    .select({ ownerId: courses.ownerId })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  if (!course) return false;
  if (!course.ownerId) return true;
  if (viewer.role === "examiner") return course.ownerId === viewer.userId;
  return Boolean(
    db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.courseId, courseId),
          eq(enrollments.userId, viewer.userId),
        ),
      )
      .get(),
  );
}
