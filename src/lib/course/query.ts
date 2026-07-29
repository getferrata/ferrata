import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { plainText } from "@/lib/text";
import { openSecret } from "@/lib/crypto/secrets";
import {
  concepts as conceptsT,
  courses as coursesT,
  cuts as cutsT,
  edges as edgesT,
  modules as modulesT,
  questions as questionsT,
  restorations as restorationsT,
  sources as sourcesT,
  type Concept,
  type Course,
  type Cut,
  type Module,
  type Question,
  type Source,
} from "@/db/schema";

export interface ModuleView {
  concept: Concept;
  module: Module | null;
  questions: Question[];
}

export interface CourseBundle {
  course: Course;
  modules: ModuleView[];
  edges: { from: string; to: string }[];
  cuts: Cut[];
  sources: Source[];
  /** Contextia-protected values to restore into module bodies at render. */
  restorations: { token: string; value: string; label: string }[];
}

/** Load a full course in topological order, with modules, questions, edges, cuts. */
export function getCourseBundle(courseId: string): CourseBundle | null {
  const courseRow = db
    .select()
    .from(coursesT)
    .where(eq(coursesT.id, courseId))
    .get();
  if (!courseRow) return null;
  // Titles/summaries print as plain text in many places; de-mark any inline
  // markdown the LLM or an imported package left in them.
  const course: Course = { ...courseRow, title: plainText(courseRow.title) };

  const concepts = db
    .select()
    .from(conceptsT)
    .where(
      and(eq(conceptsT.courseId, courseId), isNull(conceptsT.retiredAt)),
    )
    .orderBy(asc(conceptsT.topoOrder), asc(conceptsT.estimatedMinutes))
    .all()
    .map((c) => ({
      ...c,
      title: plainText(c.title),
      summary: plainText(c.summary),
    }));

  const conceptIds = concepts.map((c) => c.id);
  const mods = conceptIds.length
    ? db.select().from(modulesT).where(inArray(modulesT.conceptId, conceptIds)).all()
    : [];
  const qs = conceptIds.length
    ? db
        .select()
        .from(questionsT)
        .where(
          and(
            inArray(questionsT.conceptId, conceptIds),
            isNull(questionsT.retiredAt),
          ),
        )
        .all()
    : [];

  const moduleByConcept = new Map(mods.map((m) => [m.conceptId, m]));
  const questionsByConcept = new Map<string, Question[]>();
  for (const q of qs) {
    const list = questionsByConcept.get(q.conceptId) ?? [];
    list.push(q);
    questionsByConcept.set(q.conceptId, list);
  }

  const modules: ModuleView[] = concepts.map((concept) => ({
    concept,
    module: moduleByConcept.get(concept.id) ?? null,
    questions: questionsByConcept.get(concept.id) ?? [],
  }));

  const edges = db
    .select()
    .from(edgesT)
    .where(eq(edgesT.courseId, courseId))
    .all()
    .map((e) => ({ from: e.fromConceptId, to: e.toConceptId }));

  const cuts = db
    .select()
    .from(cutsT)
    .where(eq(cutsT.courseId, courseId))
    .all()
    .map((c) => ({ ...c, title: plainText(c.title) }));
  const srcs = db
    .select()
    .from(sourcesT)
    .where(eq(sourcesT.courseId, courseId))
    .all();

  const restos = db
    .select({
      token: restorationsT.token,
      value: restorationsT.value,
      label: restorationsT.label,
    })
    .from(restorationsT)
    .where(eq(restorationsT.courseId, courseId))
    .all()
    // Values are sealed at rest; decrypt them here, the single read boundary, so
    // rendering and the export leak-guard both see the real value. openSecret
    // returns legacy plaintext rows unchanged.
    .map((r) => ({ ...r, value: openSecret(r.value) }));

  return { course, modules, edges, cuts, sources: srcs, restorations: restos };
}
