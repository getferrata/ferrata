import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { concepts, modules, questions } from "@/db/schema";

/**
 * What a finished course is missing.
 *
 * Generation degrades rather than dying, which is right: one module failing
 * must not sink a course somebody paid for. What was missing is the other half
 * of that bargain. A course goes to `ready` with a concept nobody wrote and a
 * module nobody could write tests for, and nothing anywhere says so: the
 * dashboard's "still to test" counts questions the student has not reached, so
 * a module with no questions at all does not appear in it, it simply is not
 * there. The invariant checker finds both, but only when somebody runs it by
 * hand against the database.
 *
 * Computed on read rather than recorded at the end of the build. A stored list
 * would be wrong the moment a module is regenerated, and this is cheap: two
 * indexed queries against one course.
 */

export interface CourseGaps {
  /** Ready modules carrying no live question: read, marked done, measuring nothing. */
  untested: { conceptId: string; moduleId: string; title: string }[];
  /** Live concepts with no module at all: a hole in a path that claims to be complete. */
  missing: { conceptId: string; title: string }[];
}

export function courseGaps(courseId: string): CourseGaps {
  const live = db
    .select({
      conceptId: concepts.id,
      title: concepts.title,
      moduleId: modules.id,
      moduleStatus: modules.status,
      kind: modules.kind,
    })
    .from(concepts)
    .leftJoin(modules, eq(modules.conceptId, concepts.id))
    .where(and(eq(concepts.courseId, courseId), isNull(concepts.retiredAt)))
    .all();

  const tested = new Set(
    db
      .select({ conceptId: questions.conceptId })
      .from(questions)
      .innerJoin(concepts, eq(concepts.id, questions.conceptId))
      .where(and(eq(concepts.courseId, courseId), isNull(questions.retiredAt)))
      .all()
      .map((q) => q.conceptId),
  );

  const untested: CourseGaps["untested"] = [];
  const missing: CourseGaps["missing"] = [];
  for (const row of live) {
    if (!row.moduleId || row.moduleStatus !== "ready") {
      missing.push({ conceptId: row.conceptId, title: row.title });
      continue;
    }
    // Only a concept module owes a test. A method or meta module is the kind
    // the hand-written reference course ends with, how to troubleshoot and how
    // the interview goes, and neither is measurable with a question about a
    // fact. Nothing in the pipeline writes those kinds yet, so today this
    // changes nothing; it is here so the day something does, this does not
    // start reporting a module as broken for being what it is.
    if (row.kind === "concept" && !tested.has(row.conceptId)) {
      untested.push({
        conceptId: row.conceptId,
        moduleId: row.moduleId,
        title: row.title,
      });
    }
  }
  return { untested, missing };
}

/** True when there is nothing to report, so callers can skip the panel entirely. */
export function isComplete(gaps: CourseGaps): boolean {
  return gaps.untested.length === 0 && gaps.missing.length === 0;
}
