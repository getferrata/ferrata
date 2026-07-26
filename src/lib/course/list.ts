import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  concepts as conceptsT,
  courses as coursesT,
  enrollments as enrollmentsT,
  modules as modulesT,
  questions as questionsT,
  reviews as reviewsT,
} from "@/db/schema";
import type { CourseOrigin, CourseStatus, UserRole } from "@/db/schema";
import { plainText } from "@/lib/text";

export interface CourseSummary {
  id: string;
  title: string;
  status: CourseStatus;
  origin: CourseOrigin;
  lang: string;
  createdAt: number;
  moduleCount: number;
  questionCount: number;
  testedCount: number;
}

export interface Viewer {
  userId: string;
  role: UserRole;
}

/**
 * Courses visible to a viewer, newest first, with light progress stats.
 * Ownerless (seed/legacy) courses are visible to everyone; an examiner also sees
 * what they own, a student what they're enrolled in. Omit `viewer` for the full
 * unscoped list (internal/tests).
 */
export function listCourses(viewer?: Viewer): CourseSummary[] {
  const all = db.select().from(coursesT).orderBy(desc(coursesT.createdAt)).all();
  const rows = viewer ? scopeToViewer(all, viewer) : all;
  if (rows.length === 0) return [];

  const courseIds = rows.map((c) => c.id);
  const conceptRows = db
    .select({ id: conceptsT.id, courseId: conceptsT.courseId })
    .from(conceptsT)
    .where(inArray(conceptsT.courseId, courseIds))
    .all();
  const conceptIds = conceptRows.map((c) => c.id);
  const conceptToCourse = new Map(conceptRows.map((c) => [c.id, c.courseId]));

  const moduleRows = conceptIds.length
    ? db
        .select({ conceptId: modulesT.conceptId })
        .from(modulesT)
        .where(inArray(modulesT.conceptId, conceptIds))
        .all()
    : [];
  const questionRows = conceptIds.length
    ? db
        .select({ id: questionsT.id, conceptId: questionsT.conceptId })
        .from(questionsT)
        .where(inArray(questionsT.conceptId, conceptIds))
        .all()
    : [];
  const questionIds = questionRows.map((q) => q.id);
  const testedRows = questionIds.length
    ? db
        .select({ questionId: reviewsT.questionId })
        .from(reviewsT)
        .where(inArray(reviewsT.questionId, questionIds))
        .groupBy(reviewsT.questionId)
        .all()
    : [];
  const testedSet = new Set(testedRows.map((r) => r.questionId));

  const moduleByCourse = new Map<string, number>();
  for (const m of moduleRows) {
    const cid = conceptToCourse.get(m.conceptId);
    if (cid) moduleByCourse.set(cid, (moduleByCourse.get(cid) ?? 0) + 1);
  }
  const qByCourse = new Map<string, { total: number; tested: number }>();
  for (const q of questionRows) {
    const cid = conceptToCourse.get(q.conceptId);
    if (!cid) continue;
    const agg = qByCourse.get(cid) ?? { total: 0, tested: 0 };
    agg.total++;
    if (testedSet.has(q.id)) agg.tested++;
    qByCourse.set(cid, agg);
  }

  return rows.map((c) => ({
    id: c.id,
    title: plainText(c.title),
    status: c.status,
    origin: c.origin,
    lang: c.lang,
    createdAt: c.createdAt,
    moduleCount: moduleByCourse.get(c.id) ?? 0,
    questionCount: qByCourse.get(c.id)?.total ?? 0,
    testedCount: qByCourse.get(c.id)?.tested ?? 0,
  }));
}

type CourseRow = typeof coursesT.$inferSelect;

/** Filter courses to those a viewer may see (see listCourses doc). */
function scopeToViewer(rows: CourseRow[], viewer: Viewer): CourseRow[] {
  const enrolled = new Set(
    db
      .select({ courseId: enrollmentsT.courseId })
      .from(enrollmentsT)
      .where(eq(enrollmentsT.userId, viewer.userId))
      .all()
      .map((e) => e.courseId),
  );
  return rows.filter((c) => {
    if (!c.ownerId) return true; // ownerless seed/legacy course
    if (viewer.role === "examiner") return c.ownerId === viewer.userId;
    return enrolled.has(c.id);
  });
}

/** Delete a course and everything under it (cascades via FKs). */
export function deleteCourse(id: string): boolean {
  const res = db.delete(coursesT).where(eq(coursesT.id, id)).run();
  return res.changes > 0;
}

// Touch sql import to keep tree-shakers from complaining if unused elsewhere.
void sql;
