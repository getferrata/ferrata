import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses as coursesT } from "@/db/schema";
import { plainText } from "@/lib/text";
import { getDashboard, type ConceptRetention } from "./dashboard";
import { getRoster, type StudentProgress } from "./roster";

/**
 * What a course looks like across everyone studying it.
 *
 * This exists because the honest answer to "how is the course doing" is not a
 * single number of the same kind a student sees. Running the student dashboard
 * with the student left out does not produce an average: it produces "the latest
 * answer to each question, by whoever answered it last", a mosaic that moves
 * when any one person reviews and belongs to nobody. An examiner reading that
 * would be reading a number with no referent.
 *
 * So the aggregate is per-student first. The single figure offered alongside it
 * is the median of the roster, which is defensible: half the class is at least
 * this ready. The mean would let one absent student drag the class down; the max
 * would flatter it.
 */
export interface CourseAggregate {
  courseTitle: string;
  /** Assessed courses measure with machine-checked answers only; say so. */
  assessed: boolean;
  students: StudentProgress[];
  /** Median readiness across enrolled students; null until anyone is measured. */
  medianRetention: number | null;
  /** Students with at least one measured answer. */
  measuredStudents: number;
  /**
   * Concepts weak for at least half of the students who have been measured.
   * A concept one person struggles with is that person's gap; one that half the
   * class is weak on is a problem with the module, and worth the author's time.
   */
  weakForMany: { conceptId: string; title: string; weakStudents: number }[];
}

/** Below this, a concept counts as weak for a student. */
const WEAK_BELOW = 0.5;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function getCourseAggregate(
  courseId: string,
  at: Date = new Date(),
): CourseAggregate {
  const course = db
    .select({ title: coursesT.title, mode: coursesT.assessmentMode })
    .from(coursesT)
    .where(eq(coursesT.id, courseId))
    .get();
  const courseTitle = plainText(course?.title ?? "");
  const assessed = course?.mode === "assessed";
  const students = getRoster(courseId, at);

  // Only students who have actually been measured carry the median. Counting an
  // enrolled student who has answered nothing as a zero would report the class
  // as unready when the truth is that it has not started.
  const measured = students.filter((s) => s.retention !== null);
  const medianRetention = median(measured.map((s) => s.retention as number));

  // Concept-level weakness has to come from each student's own dashboard, since
  // that is the only place the per-concept figure is scoped to one person.
  const weakCount = new Map<string, { title: string; n: number }>();
  for (const s of measured) {
    const d = getDashboard(courseId, at, s.userId);
    if (!d) continue;
    for (const c of d.concepts as ConceptRetention[]) {
      if (c.retention === null || c.retention >= WEAK_BELOW) continue;
      const cur = weakCount.get(c.conceptId) ?? { title: c.title, n: 0 };
      cur.n += 1;
      weakCount.set(c.conceptId, cur);
    }
  }
  const half = Math.ceil(measured.length / 2);
  const weakForMany = [...weakCount.entries()]
    .filter(([, v]) => measured.length > 0 && v.n >= half)
    .map(([conceptId, v]) => ({
      conceptId,
      title: v.title,
      weakStudents: v.n,
    }))
    .sort((a, b) => b.weakStudents - a.weakStudents);

  return {
    courseTitle,
    assessed,
    students,
    medianRetention,
    measuredStudents: measured.length,
    weakForMany,
  };
}
