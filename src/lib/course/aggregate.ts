import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { courses as coursesT, modules as modulesT } from "@/db/schema";
import { plainText } from "@/lib/text";
import { conceptRetentionByStudent } from "./dashboard";
import { getRoster, type StudentProgress } from "./roster";
import { failedQuestionsByConcept } from "./weakness";

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
  weakForMany: WeakConcept[];
}

export interface WeakConcept {
  conceptId: string;
  /**
   * The module to rewrite, when one exists. Null for a concept whose module was
   * never written or failed: there is nothing to offer a rewrite of, and an
   * action pointing at a missing module would 404 on click.
   */
  moduleId: string | null;
  title: string;
  weakStudents: number;
  /**
   * Questions in this concept more readers get wrong than right: the material a
   * rewrite would actually be given. Zero means the class is weak by the
   * spacing model's reckoning but nobody has failed a specific question, so a
   * rewrite has nothing concrete to aim at and the page should not pretend
   * otherwise.
   */
  failedQuestions: number;
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

  // Concept-level weakness is per student, because that is the only scope in
  // which the figure means anything. Read for the whole roster in one pass:
  // asking each student's dashboard separately re-read every review in the
  // course once per student, and the class this page exists for is the big one.
  const byStudent = conceptRetentionByStudent(
    courseId,
    measured.map((s) => s.userId),
    at,
  );
  const weakCount = new Map<string, { title: string; n: number }>();
  for (const concepts of byStudent.values()) {
    for (const c of concepts) {
      if (c.retention === null || c.retention >= WEAK_BELOW) continue;
      const cur = weakCount.get(c.conceptId) ?? { title: c.title, n: 0 };
      cur.n += 1;
      weakCount.set(c.conceptId, cur);
    }
  }
  const half = Math.ceil(measured.length / 2);
  const weak = [...weakCount.entries()]
    .filter(([, v]) => measured.length > 0 && v.n >= half)
    .sort((a, b) => b[1].n - a[1].n);

  // Diagnosis is only half of it: the page offers to rewrite these modules
  // against what readers got wrong, so it needs the module to rewrite and
  // whether there is anything to rewrite it against. Both read in one query
  // over the whole weak set rather than one per row.
  const weakIds = weak.map(([conceptId]) => conceptId);
  const moduleByConcept = new Map<string, string>();
  if (weakIds.length > 0) {
    for (const m of db
      .select({ id: modulesT.id, conceptId: modulesT.conceptId })
      .from(modulesT)
      .where(inArray(modulesT.conceptId, weakIds))
      .all()) {
      moduleByConcept.set(m.conceptId, m.id);
    }
  }
  const failures = failedQuestionsByConcept(courseId, weakIds);

  const weakForMany: WeakConcept[] = weak.map(([conceptId, v]) => ({
    conceptId,
    moduleId: moduleByConcept.get(conceptId) ?? null,
    title: v.title,
    weakStudents: v.n,
    failedQuestions: failures.get(conceptId)?.length ?? 0,
  }));

  return {
    courseTitle,
    assessed,
    students,
    medianRetention,
    measuredStudents: measured.length,
    weakForMany,
  };
}
