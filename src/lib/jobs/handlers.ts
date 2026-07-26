import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  concepts as conceptsT,
  courses as coursesT,
  cuts as cutsT,
  edges as edgesT,
  modules as modulesT,
  questions as questionsT,
  type Concept,
  type DepthPreset,
} from "@/db/schema";
import { newId, now } from "@/lib/util/id";
import { getLogger } from "@/lib/log";
import { enqueue } from "./queue";
import { currentActor } from "@/lib/llm/actor";

const log = getLogger("pipeline");
import { runIntake } from "@/lib/llm/tasks/intake";
import { intakeDepthGuidance, moduleDepthGuidance } from "@/lib/llm/depth";
import {
  runInterviewQuestions,
  type InterviewState,
} from "@/lib/llm/tasks/interview_questions";
import { runBuildGraph } from "@/lib/llm/tasks/build_graph";
import { runWriteModule } from "@/lib/llm/tasks/write_module";
import { runConcretenessPass } from "@/lib/llm/tasks/concreteness_pass";
import { runWriteQuestions } from "@/lib/llm/tasks/write_questions";
import { runSchedule } from "@/lib/llm/tasks/schedule";
import { runGlossary } from "@/lib/llm/tasks/glossary";
import { breakCycles, topoSort, type DagEdge } from "@/lib/graph/dag";
import { scrubTemplateArtifacts } from "@/lib/course/scrub";
import { triage } from "@/lib/graph/triage";
import { evalModule } from "@/lib/evals";
import {
  formatGrounding,
  loadCourseChunks,
  retrieve,
  sourceOverview,
  type ChunkDoc,
} from "@/lib/sources/query";

export type JobHandler = (payload: unknown) => Promise<unknown>;

interface CoursePayload {
  courseId: string;
  sourcePrompt: string;
}

function courseId(p: unknown): string {
  if (
    typeof p === "object" &&
    p !== null &&
    typeof (p as CoursePayload).courseId === "string"
  ) {
    return (p as CoursePayload).courseId;
  }
  throw new Error("job payload missing courseId");
}

// --- stage 0: authoring interview --------------------------------------------

const interviewHandler: JobHandler = async (payload) => {
  const id = courseId(payload);
  const course = db.select().from(coursesT).where(eq(coursesT.id, id)).get();
  if (!course) throw new Error("interview: course not found");

  const result = await runInterviewQuestions(course.sourcePrompt, id);
  const state: InterviewState = { questions: result.questions, answers: {} };
  db.update(coursesT)
    .set({ interviewJson: JSON.stringify(state), status: "interview" })
    .where(eq(coursesT.id, id))
    .run();
  return { questions: result.questions.length };
};

// --- stage 1: intake ---------------------------------------------------------

const intakeHandler: JobHandler = async (payload) => {
  const id = courseId(payload);
  const course = db.select().from(coursesT).where(eq(coursesT.id, id)).get();
  if (!course) throw new Error("intake: course not found");

  // Ground intake in the attached material so concepts reflect it, not a guess.
  const overview = sourceOverview(loadCourseChunks(id));
  const material = overview
    ? `${course.sourcePrompt}\n\n## Materiale allegato (estratti)\n${overview}`
    : course.sourcePrompt;

  const result = await runIntake(
    material,
    course.authorContextMd ?? "",
    id,
    intakeDepthGuidance(course.depthPreset),
  );

  db.transaction((tx) => {
    tx.update(coursesT)
      .set({
        title: result.title,
        lang: result.lang,
        objective: result.objective,
        domain: result.domain,
        startLevel: result.startLevel,
        concretenessRule: result.concretenessRule,
        budgetMinutes: result.budgetMinutes ?? course.budgetMinutes ?? null,
        // Pause for the author to keep/drop concepts before we spend tokens
        // writing modules (see /api/courses/:id/concepts).
        status: "concept_review",
      })
      .where(eq(coursesT.id, id))
      .run();

    for (const c of result.candidateConcepts) {
      tx.insert(conceptsT)
        .values({
          id: newId("concept"),
          courseId: id,
          title: c.title,
          summary: c.summary,
          priority: c.priority,
          estimatedMinutes: c.estimatedMinutes,
          depthLevel: c.depthLevel,
        })
        .run();
    }

    // What intake read and set aside. Budget triage adds its own cuts later;
    // these are the earlier, larger ones, and they used to vanish without trace.
    for (const s of result.outOfScope ?? []) {
      tx.insert(cutsT)
        .values({
          id: newId("cut"),
          courseId: id,
          conceptId: "intake",
          title: s.title,
          reason: s.reason,
        })
        .run();
    }
  });

  return { conceptCount: result.candidateConcepts.length, deadline: result.deadline };
};

// --- stage 2: prerequisite graph + triage ------------------------------------

const buildGraphHandler: JobHandler = async (payload) => {
  const id = courseId(payload);
  const course = db.select().from(coursesT).where(eq(coursesT.id, id)).get();
  if (!course) throw new Error("build_graph: course not found");

  const concepts = db
    .select()
    .from(conceptsT)
    .where(eq(conceptsT.courseId, id))
    .orderBy(asc(conceptsT.estimatedMinutes))
    .all();
  if (concepts.length === 0) throw new Error("build_graph: no concepts");

  const graph = await runBuildGraph(
    {
      objective: course.objective ?? "",
      domain: course.domain ?? "",
      startLevel: course.startLevel ?? "",
      concepts: concepts.map((c) => ({ title: c.title, summary: c.summary })),
    },
    id,
  );

  const idByIndex = (i: number): string | null => concepts[i]?.id ?? null;
  const rawEdges: DagEdge[] = graph.edges
    .map((e) => ({ from: idByIndex(e.fromIndex), to: idByIndex(e.toIndex) }))
    .filter(
      (e): e is DagEdge => e.from != null && e.to != null && e.from !== e.to,
    );

  const priorityOf = (cid: string) =>
    concepts.find((c) => c.id === cid)?.priority ?? "medium";
  const { edges: acyclic } = breakCycles(
    concepts.map((c) => c.id),
    rawEdges,
    priorityOf,
  );
  const order = topoSort(
    concepts.map((c) => c.id),
    acyclic,
  );

  const triaged = triage(
    concepts.map((c) => ({
      id: c.id,
      title: c.title,
      priority: c.priority,
      estimatedMinutes: c.estimatedMinutes,
    })),
    acyclic,
    course.budgetMinutes,
  );
  const survivors = new Set(triaged.survivorIds);

  db.transaction((tx) => {
    for (const e of acyclic) {
      if (!survivors.has(e.from) || !survivors.has(e.to)) continue;
      tx.insert(edgesT)
        .values({
          id: newId("edge"),
          courseId: id,
          fromConceptId: e.from,
          toConceptId: e.to,
        })
        .run();
    }
    order.forEach((cid, i) => {
      if (survivors.has(cid)) {
        tx.update(conceptsT)
          .set({ topoOrder: i })
          .where(eq(conceptsT.id, cid))
          .run();
      }
    });
    for (const cut of triaged.cuts) {
      tx.insert(cutsT)
        .values({
          id: newId("cut"),
          courseId: id,
          conceptId: cut.id,
          title: cut.title,
          reason: cut.reason,
        })
        .run();
      tx.delete(conceptsT).where(eq(conceptsT.id, cut.id)).run();
    }
    tx.update(coursesT)
      .set({ status: "generating" })
      .where(eq(coursesT.id, id))
      .run();
  });

  // Chained from inside a running job: same person keeps paying for it.
  enqueue("generate_course", {
    courseId: id,
    actorUserId: currentActor()?.userId ?? null,
  });
  return { survivors: triaged.survivorIds.length, cuts: triaged.cuts.length };
};

// --- stage 3: module generation + concreteness + eval + questions ------------

function anchorTerms(sourcePrompt: string, titles: string[]): string[] {
  const set = new Set<string>();
  for (const t of sourcePrompt.match(/\b[A-Z][A-Za-z0-9.]{1,}\b|\b\d[\w.]*\b/g) ??
    [])
    if (t.length >= 2) set.add(t);
  for (const t of titles)
    for (const w of t.split(/\s+/))
      if (/^[A-Z]/.test(w) && w.length >= 3) set.add(w);
  return [...set].slice(0, 40);
}

function questionCount(depth: number): number {
  return [4, 4, 6, 8][Math.max(0, Math.min(3, depth))] ?? 5;
}

/**
 * Of the given concepts, those whose module is complete: written, marked ready,
 * and carrying at least one test. Used to resume generation without redoing
 * work that is already paid for.
 */
export function finishedConcepts(conceptIds: string[]): Set<string> {
  if (conceptIds.length === 0) return new Set();
  const ready = db
    .select({ conceptId: modulesT.conceptId })
    .from(modulesT)
    .where(
      and(
        eq(modulesT.status, "ready"),
        inArray(modulesT.conceptId, conceptIds),
      ),
    )
    .all()
    .map((m) => m.conceptId);
  if (ready.length === 0) return new Set();
  const tested = new Set(
    db
      .select({ conceptId: questionsT.conceptId })
      .from(questionsT)
      .where(inArray(questionsT.conceptId, ready))
      .all()
      .map((q) => q.conceptId),
  );
  return new Set(ready.filter((c) => tested.has(c)));
}

const generateCourseHandler: JobHandler = async (payload) => {
  const id = courseId(payload);
  const course = db.select().from(coursesT).where(eq(coursesT.id, id)).get();
  if (!course) throw new Error("generate_course: course not found");

  const concepts = db
    .select()
    .from(conceptsT)
    .where(eq(conceptsT.courseId, id))
    .orderBy(asc(conceptsT.topoOrder))
    .all();
  const edges = db.select().from(edgesT).where(eq(edgesT.courseId, id)).all();
  const chunks = loadCourseChunks(id); // grounding corpus (empty if no sources)
  const anchors = anchorTerms(
    course.sourcePrompt,
    concepts.map((c) => c.title),
  );

  const prereqTitles = (concept: Concept): string[] =>
    edges
      .filter((e) => e.toConceptId === concept.id)
      .map((e) => concepts.find((c) => c.id === e.fromConceptId)?.title)
      .filter((t): t is string => Boolean(t));

  // Modules already finished stay finished. This job retries on failure and is
  // picked up again after a restart, and rewriting a finished module would both
  // duplicate the row and bill the author a second time for it.
  //
  // "Finished" means a ready module that also has its tests: a module with no
  // questions defeats the whole verification model, so one that was written
  // just before the process died gets written again rather than kept.
  const done = finishedConcepts(concepts.map((c) => c.id));

  let generated = 0;
  for (const concept of concepts) {
    if (done.has(concept.id)) {
      generated++;
      continue;
    }
    try {
      const moduleId = await generateOneModule(
        id,
        course,
        concept,
        prereqTitles(concept),
        anchors,
        chunks,
      );
      if (moduleId) generated++;
    } catch (err) {
      // One module failing must not sink the whole course.
      log.error(
        `generate_course: module for "${concept.title}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (generated === 0) throw new Error("generate_course: no modules generated");

  // Course-level artifacts.
  const [scheduleRes, glossaryRes] = await Promise.all([
    course.budgetMinutes != null
      ? runSchedule(
          {
            lang: course.lang,
            deadline: "",
            budgetMinutes: course.budgetMinutes,
            modules: concepts.map((c) => ({
              title: c.title,
              priority: c.priority,
              estimatedMinutes: c.estimatedMinutes,
              depthLevel: c.depthLevel,
            })),
          },
          id,
        ).catch(() => null)
      : Promise.resolve(null),
    runGlossary(
      {
        lang: course.lang,
        objective: course.objective ?? "",
        modules: concepts.map((c) => ({ title: c.title, summary: c.summary })),
      },
      id,
    ).catch(() => null),
  ]);

  db.update(coursesT)
    .set({
      scheduleMd: scheduleRes?.scheduleMd ?? null,
      glossaryMd: glossaryRes?.glossaryMd ?? null,
      status: "ready",
    })
    .where(eq(coursesT.id, id))
    .run();

  return { modules: generated };
};

const MAX_MODULE_ATTEMPTS = 2;

// Lite mode (FERRATA_LITE=1): one LLM call per module instead of ~4, skipping the
// separate concreteness pass and the eval-driven regeneration. Much lighter on a
// rate-limited free tier (e.g. Groq's 12k tokens/min), at some quality cost. The
// quality guidance still lives inside the write_module prompt itself.
const LITE = process.env.FERRATA_LITE === "1";

async function generateOneModule(
  id: string,
  course: { lang: string; objective: string | null; domain: string | null; startLevel: string | null; sourcePrompt: string; concretenessRule: string | null; depthPreset: DepthPreset },
  concept: Concept,
  prereqs: string[],
  anchors: string[],
  chunks: ChunkDoc[],
): Promise<string | null> {
  let best: { bodyMd: string; score: number; report: unknown } | null = null;

  // Retrieve the material most relevant to this concept, to ground on + cite.
  const grounded = retrieve(`${concept.title} ${concept.summary}`, chunks, 5);
  const sources = formatGrounding(grounded);

  const attempts = LITE ? 1 : MAX_MODULE_ATTEMPTS;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const drafted = await runWriteModule(
      {
        lang: course.lang,
        objective: course.objective ?? "",
        domain: course.domain ?? "",
        startLevel: course.startLevel ?? "",
        sourcePrompt: course.sourcePrompt,
        concretenessRule: course.concretenessRule ?? "",
        conceptTitle: concept.title,
        conceptSummary: concept.summary,
        depthLevel: concept.depthLevel,
        depthGuidance: moduleDepthGuidance(course.depthPreset),
        prerequisites: prereqs,
        sources,
      },
      id,
    );

    // Lite: accept the single draft as-is (prompt carries the quality rules).
    if (LITE) {
      best = { bodyMd: drafted.bodyMd, score: 1, report: { lite: true } };
      break;
    }

    // Mandatory, separate concreteness pass.
    const concrete = await runConcretenessPass(
      {
        lang: course.lang,
        concretenessRule: course.concretenessRule ?? "",
        conceptTitle: concept.title,
        sourcePrompt: course.sourcePrompt,
        bodyMd: drafted.bodyMd,
      },
      id,
    ).catch(() => ({ bodyMd: drafted.bodyMd, notes: [] }));

    concrete.bodyMd = scrubTemplateArtifacts(concrete.bodyMd);

    const report = await evalModule(
      concrete.bodyMd,
      { anchorTerms: anchors, domain: course.domain ?? "" },
      {
        sourcePrompt: course.sourcePrompt,
        conceptTitle: concept.title,
        // The same material the module was written from, so the judge can tell
        // an honest gap from a confident invention.
        sources,
      },
      id,
    );

    if (!best || report.score > best.score) {
      best = { bodyMd: concrete.bodyMd, score: report.score, report };
    }
    if (report.pass) break; // good enough; stop regenerating
  }

  if (!best) return null;

  const moduleId = newId("module");
  // A concept has exactly one module and one set of tests. Clearing first means
  // a half-written attempt from an interrupted run is replaced rather than
  // duplicated beside it. Safe here because generation always precedes study:
  // nobody has answered these questions yet.
  db.delete(modulesT).where(eq(modulesT.conceptId, concept.id)).run();
  db.delete(questionsT).where(eq(questionsT.conceptId, concept.id)).run();
  db.insert(modulesT)
    .values({
      id: moduleId,
      conceptId: concept.id,
      kind: "concept",
      bodyMd: best.bodyMd,
      status: "ready",
      evalScore: best.score,
      evalReportJson: JSON.stringify(best.report),
      generatedAt: now(),
    })
    .run();

  // Inline tests for this module. A module with zero questions defeats the
  // whole verification model, so a failed generation gets one cheaper retry
  // (count 1, less JSON for small local models to get wrong) before giving up.
  const wantQuestions = questionCount(concept.depthLevel);
  const questionArgs = {
    lang: course.lang,
    conceptTitle: concept.title,
    bodyMd: best.bodyMd,
    depthLevel: concept.depthLevel,
    sourcePrompt: course.sourcePrompt,
  };
  let qs = await runWriteQuestions(
    { ...questionArgs, count: wantQuestions },
    id,
  ).catch(() => null);
  if (!qs || qs.questions.length === 0) {
    log.warn(
      `write_questions for "${concept.title}" produced nothing, retrying with count 1`,
    );
    qs = await runWriteQuestions({ ...questionArgs, count: 1 }, id).catch(
      () => null,
    );
  }
  if (!qs) {
    log.error(`write_questions for "${concept.title}" failed twice, module ships untested`);
    qs = { questions: [] };
  } else if (qs.questions.length < wantQuestions) {
    log.warn(
      `write_questions for "${concept.title}" returned ${qs.questions.length}/${wantQuestions}`,
    );
  }

  for (const q of qs.questions) {
    db.insert(questionsT)
      .values({
        id: newId("q"),
        conceptId: concept.id,
        prompt: q.prompt,
        expectedAnswer: q.expectedAnswer,
        bloomLevel: q.bloomLevel,
        format: q.format,
        optionsJson: q.options ? JSON.stringify(q.options) : null,
        misconceptionsJson: JSON.stringify(q.misconceptions),
      })
      .run();
  }

  return moduleId;
}

export const HANDLERS: Record<string, JobHandler> = {
  interview_questions: interviewHandler,
  intake: intakeHandler,
  build_graph: buildGraphHandler,
  generate_course: generateCourseHandler,
};
