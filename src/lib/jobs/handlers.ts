import { and, asc, eq, inArray, isNull } from "drizzle-orm";
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
import {
  runWriteModule,
  verifyModule,
  type RepairRequest,
} from "@/lib/llm/tasks/write_module";
import { runConcretenessPass } from "@/lib/llm/tasks/concreteness_pass";
import { looksTruncated } from "@/lib/llm/truncation";
import { runWriteQuestions } from "@/lib/llm/tasks/write_questions";
import { runSchedule } from "@/lib/llm/tasks/schedule";
import { runGlossary } from "@/lib/llm/tasks/glossary";
import { countBlanks } from "@/lib/review/grade";
import { breakCycles, topoSort, type DagEdge } from "@/lib/graph/dag";
import { scrubTemplateArtifacts } from "@/lib/course/scrub";
import { triage } from "@/lib/graph/triage";
import { evalModule } from "@/lib/evals";
import {
  buildIndex,
  formatGrounding,
  loadCourseChunks,
  retrieveWith,
  sourceOverview,
  sourceTexts,
  type Bm25Index,
} from "@/lib/sources/query";
import { runProposeUpdates } from "@/lib/llm/tasks/propose_updates";
import { preflightTag, runPreflight } from "@/lib/llm/preflight";
import { recordProposals } from "@/lib/course/proposals";

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

  // The interview sees what was attached, so it does not spend a question
  // asking the author to describe material the pipeline already has.
  const result = await runInterviewQuestions(
    course.sourcePrompt,
    sourceOverview(loadCourseChunks(id)),
    id,
  );
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
  // The brief is the author's own words (trusted); the attached overview is
  // imported and untrusted, so intake keeps them in separate channels.
  const overview = sourceOverview(loadCourseChunks(id));
  const result = await runIntake(
    course.sourcePrompt,
    overview,
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
      .where(
        and(inArray(questionsT.conceptId, ready), isNull(questionsT.retiredAt)),
      )
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
    .where(and(eq(conceptsT.courseId, id), isNull(conceptsT.retiredAt)))
    .orderBy(asc(conceptsT.topoOrder))
    .all();
  const edges = db.select().from(edgesT).where(eq(edgesT.courseId, id)).all();
  // Grounding corpus (empty if no sources). Tokenised once here, not once per
  // module: a 15-module course reused the same corpus 15 times.
  const index = buildIndex(loadCourseChunks(id));
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
  // Bodies that are written and accepted but whose tests did not arrive. They
  // need one call, not four.
  const untested = untestedConcepts(
    concepts.filter((c) => !done.has(c.id)).map((c) => c.id),
  );

  let generated = 0;
  for (const concept of concepts) {
    if (done.has(concept.id)) {
      generated++;
      continue;
    }
    const stored = untested.get(concept.id);
    if (stored) {
      try {
        const rows = await writeQuestionRows(
          id,
          course,
          concept,
          stored.bodyMd,
        );
        if (rows.length > 0) {
          db.transaction((tx) => {
            for (const row of rows) tx.insert(questionsT).values(row).run();
          });
          generated++;
          continue;
        }
        // Still no tests. Fall through and rewrite the module: a body the test
        // writer cannot make a single question out of is itself the suspect.
        log.warn(
          `no tests for the stored body of "${concept.title}"; rewriting the module`,
        );
      } catch (err) {
        log.error(
          `tests-only pass for "${concept.title}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    try {
      const moduleId = await generateOneModule(
        id,
        course,
        concept,
        prereqTitles(concept),
        anchors,
        index,
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

  // Course-level artifacts. Announced as its own stage: these are two more
  // model calls, and until this existed the screen showed a finished progress
  // bar and a module counter that had stopped being true.
  db.update(coursesT)
    .set({ status: "finishing" })
    .where(eq(coursesT.id, id))
    .run();
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
              // The same edges the student sees as the prerequisite map. The
              // scheduler is invited to reorder, and without these it reorders
              // through the prerequisites.
              prerequisites: prereqTitles(c),
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
        // Titles say which terms matter; the material says what they mean here.
        sources: sourceOverview(loadCourseChunks(id)),
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

// --- regenerate one module ---------------------------------------------------

/**
 * Rewrite a single module through the full quality loop, without rebuilding the
 * course around it. Used when the author judges one module bad, and to write
 * the module for a concept added after the build.
 *
 * The course stays "ready" throughout: the other twelve modules are still a
 * course, and students keep studying them while this one is rewritten.
 */
const regenerateModuleHandler: JobHandler = async (payload) => {
  const id = courseId(payload);
  const conceptId = (payload as { conceptId?: unknown }).conceptId;
  if (typeof conceptId !== "string" || !conceptId) {
    throw new Error("regenerate_module: payload missing conceptId");
  }

  const course = db.select().from(coursesT).where(eq(coursesT.id, id)).get();
  if (!course) throw new Error("regenerate_module: course not found");
  const concept = db
    .select()
    .from(conceptsT)
    .where(and(eq(conceptsT.id, conceptId), eq(conceptsT.courseId, id)))
    .get();
  // Deleted between enqueue and run (e.g. a retire proposal approved in the
  // meantime): nothing to write, and failing would only retry into the same.
  if (!concept) return { skipped: "concept no longer exists" };

  const concepts = db
    .select()
    .from(conceptsT)
    .where(and(eq(conceptsT.courseId, id), isNull(conceptsT.retiredAt)))
    .orderBy(asc(conceptsT.topoOrder))
    .all();
  const edges = db.select().from(edgesT).where(eq(edgesT.courseId, id)).all();
  const index = buildIndex(loadCourseChunks(id));
  const anchors = anchorTerms(
    course.sourcePrompt,
    concepts.map((c) => c.title),
  );
  const prereqs = edges
    .filter((e) => e.toConceptId === concept.id)
    .map((e) => concepts.find((c) => c.id === e.fromConceptId)?.title)
    .filter((t): t is string => Boolean(t));

  const moduleId = await generateOneModule(
    id,
    course,
    concept,
    prereqs,
    anchors,
    index,
  );
  if (!moduleId) throw new Error("regenerate_module: nothing was written");
  return { moduleId };
};

type QuestionRow = typeof questionsT.$inferInsert;

/**
 * The tests for one module body, ready to insert.
 *
 * A module with zero questions defeats the whole verification model, so a
 * failed generation gets one cheaper retry (count 1, less JSON for a small
 * local model to get wrong) before giving up. Kept separate from writing the
 * body because the two fail independently: a body can be good and its tests
 * still not arrive, and that case must not cost a rewrite of the body.
 */
export async function writeQuestionRows(
  courseId: string,
  course: { lang: string; sourcePrompt: string },
  concept: Concept,
  bodyMd: string,
): Promise<QuestionRow[]> {
  const want = questionCount(concept.depthLevel);
  const args = {
    lang: course.lang,
    conceptTitle: concept.title,
    bodyMd,
    depthLevel: concept.depthLevel,
    sourcePrompt: course.sourcePrompt,
  };
  let qs = await runWriteQuestions({ ...args, count: want }, courseId).catch(
    () => null,
  );
  if (!qs || qs.questions.length === 0) {
    // Half, not one. The retry exists because a long list is more for a model
    // to get wrong, so asking for less is right; asking for a single question
    // is not. On the first hosted-model run every depth-3 module took this
    // path, and a module carrying the hardest material in the course came out
    // with one test, which cannot measure whether anyone learned it. Halving
    // keeps the retry cheap and keeps the module worth sitting.
    const fewer = Math.max(2, Math.ceil(want / 2));
    log.warn(
      `write_questions for "${concept.title}" produced nothing, retrying with count ${fewer}`,
    );
    qs = await runWriteQuestions({ ...args, count: fewer }, courseId).catch(
      () => null,
    );
  }
  if (!qs) {
    log.error(
      `write_questions for "${concept.title}" failed twice, module ships untested`,
    );
    return [];
  }
  if (qs.questions.length < want) {
    log.warn(
      `write_questions for "${concept.title}" returned ${qs.questions.length}/${want}`,
    );
  }
  return qs.questions.map((q) => {
    // Blanks are stored only when they match the blanks the prompt actually
    // shows. A mismatch would mark a right answer wrong, which is worse than
    // leaving the question to the student.
    const blanks =
      q.format === "cloze" &&
      q.blanks?.length &&
      q.blanks.length === countBlanks(q.prompt)
        ? JSON.stringify(q.blanks)
        : null;
    return {
      id: newId("q"),
      conceptId: concept.id,
      prompt: q.prompt,
      expectedAnswer: q.expectedAnswer,
      bloomLevel: q.bloomLevel,
      format: q.format,
      optionsJson: q.options ? JSON.stringify(q.options) : null,
      blanksJson: blanks,
      misconceptionsJson: JSON.stringify(q.misconceptions),
    };
  });
}

/**
 * Concepts whose module body is written and ready but carries no live test,
 * mapped to that body.
 *
 * These are the expensive ones to get wrong. `finishedConcepts` rightly refuses
 * to call such a module done, but the resume path then rewrote it from scratch:
 * four calls to replace a body that was already accepted, every time the worker
 * came back, because the one call that failed was the last one. Handing back the
 * stored body lets the resume pay only for the tests.
 */
export function untestedConcepts(
  conceptIds: string[],
): Map<string, { moduleId: string; bodyMd: string }> {
  const out = new Map<string, { moduleId: string; bodyMd: string }>();
  if (conceptIds.length === 0) return out;
  const ready = db
    .select({
      id: modulesT.id,
      conceptId: modulesT.conceptId,
      bodyMd: modulesT.bodyMd,
    })
    .from(modulesT)
    .where(
      and(eq(modulesT.status, "ready"), inArray(modulesT.conceptId, conceptIds)),
    )
    .all()
    .filter((m): m is typeof m & { bodyMd: string } => Boolean(m.bodyMd));
  if (ready.length === 0) return out;
  const tested = new Set(
    db
      .select({ conceptId: questionsT.conceptId })
      .from(questionsT)
      .where(
        and(
          inArray(
            questionsT.conceptId,
            ready.map((m) => m.conceptId),
          ),
          isNull(questionsT.retiredAt),
        ),
      )
      .all()
      .map((q) => q.conceptId),
  );
  for (const m of ready) {
    if (!tested.has(m.conceptId)) {
      out.set(m.conceptId, { moduleId: m.id, bodyMd: m.bodyMd });
    }
  }
  return out;
}

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
  index: Bm25Index,
): Promise<string | null> {
  let best: {
    bodyMd: string;
    score: number;
    report: unknown;
    hard: number;
  } | null = null;

  // Retrieve the material most relevant to this concept, to ground on + cite.
  const grounded = retrieveWith(index, `${concept.title} ${concept.summary}`, 5);
  const sources = formatGrounding(grounded);

  // Carries the previous attempt's body plus the exact defects to fix, so a
  // second attempt is a targeted repair rather than a blind reroll.
  let repair: RepairRequest | undefined;

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
      repair,
    );

    // Lite: accept the single draft as-is (prompt carries the quality rules).
    if (LITE) {
      best = { bodyMd: drafted.bodyMd, score: 1, report: { lite: true }, hard: 0 };
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
        // The same excerpts the draft was written from, so the pass has facts to
        // be concrete with instead of having to invent them.
        sources,
      },
      id,
    ).catch((err: unknown) => {
      // Falling back to the draft is right: a module without the pass is worse
      // than one with it, and much better than no module. Doing it silently is
      // not. Three of the fourteen modules in the first hosted-model course
      // shipped without ever being made concrete, and nothing anywhere said so:
      // the pass is described as mandatory, and this is the branch where it
      // stops being.
      log.warn(
        `concreteness pass for "${concept.title}" failed, shipping the draft as written: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { bodyMd: drafted.bodyMd, notes: [] };
    });

    concrete.bodyMd = scrubTemplateArtifacts(concrete.bodyMd);

    // The concreteness pass re-emits the whole body; if that rewrite was cut off
    // at the token cap, keep the complete draft rather than a body that stops
    // mid-sentence. The draft already carries the house anatomy; concreteness is
    // an enhancement, and a truncated enhancement is worse than none.
    if (looksTruncated(concrete.bodyMd) && !looksTruncated(drafted.bodyMd)) {
      log.warn(
        `concreteness pass for "${concept.title}" came back truncated; keeping the full draft`,
      );
      concrete.bodyMd = drafted.bodyMd;
    }

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

    // Deterministic checks the judge is bad at: a citation either names a real
    // source or it does not. Hard violations block acceptance even when the judge
    // was happy, which is the point, since a confident invention is exactly what
    // the judge waves through.
    const v = verifyModule({
      bodyMd: concrete.bodyMd,
      sources: grounded,
      depthLevel: concept.depthLevel,
    });

    // Prefer a clean body over a higher-scoring one that fails a hard check: a
    // module with an invented citation is worse than a slightly duller honest one.
    const candidate = {
      bodyMd: concrete.bodyMd,
      score: report.score,
      report,
      hard: v.hard.length,
    };
    if (
      !best ||
      candidate.hard < best.hard ||
      (candidate.hard === best.hard && candidate.score > best.score)
    ) {
      best = candidate;
    }

    // Accept only when the judge passed AND nothing deterministic is broken.
    if (report.pass && v.hard.length === 0) break;

    // Otherwise, if a retry remains, turn this attempt's specific defects into a
    // targeted repair instead of a blind reroll.
    if (attempt < attempts) {
      const notes = [
        ...v.hard,
        ...v.soft,
        ...(report.judge?.specificityViolations ?? []).map(
          (s) => `Rewrite this generic passage to be specific: ${s}`,
        ),
        ...(report.judge?.groundingViolations ?? []).map(
          (s) => `Remove or ground this unsupported claim: ${s}`,
        ),
        ...(report.rubrics.pass
          ? []
          : report.rubrics.checks
              .filter((c) => !c.pass)
              .map((c) => `Improve: ${c.detail}`)),
      ].slice(0, 12);
      repair = notes.length
        ? { priorBody: concrete.bodyMd, notes }
        : undefined;
    }
  }

  if (!best) return null;

  if (best.hard > 0) {
    log.warn(
      `module "${concept.title}" ships with ${best.hard} unresolved check(s) after ${attempts} attempt(s); best available kept`,
    );
  }

  // Last line of defence: every attempt truncated (the draft and the pass both
  // stopped mid-sentence). Nothing to fall back to, but do not stay silent about
  // shipping a partial module.
  if (looksTruncated(best.bodyMd)) {
    log.error(
      `module "${concept.title}" ships with a body that appears truncated; check the token cap`,
    );
  }

  // Write the tests BEFORE touching the DB. On a regeneration the old module is
  // live and students may be answering it, so the delete and the inserts have
  // to be one atomic swap with no gap; generating the questions first, then
  // swapping, means there is never a moment where a ready module has no tests.
  const questionRows = await writeQuestionRows(
    id,
    course,
    concept,
    best.bodyMd,
  );

  // Reuse the existing module's id on a regeneration. A new id would 404 the
  // module URL the author is sitting on and orphan any resume bookmark; the
  // course has one module per concept, so keeping the id is both correct and
  // kinder. A first build has no row yet, so it mints one.
  const existing = db
    .select({ id: modulesT.id })
    .from(modulesT)
    .where(eq(modulesT.conceptId, concept.id))
    .get();
  const moduleId = existing?.id ?? newId("module");
  // The swap, atomic: replacing the old module and its tests and writing the
  // new ones is one transaction. A regeneration replaces a live module; without
  // this a reader between the two would see a module with no tests, and a
  // student answering an old question would hit a gone row.
  //
  // The old questions are RETIRED, not deleted. `reviews.questionId` cascades,
  // so deleting them would take every student's answers, their FSRS state and
  // the sure-and-wrong record with them: silent, retroactive, unrecoverable.
  // An author rewording one paragraph must not erase three weeks of somebody
  // else's study. Retired questions are filtered out of everything that lists
  // what to study; the ledger keeps them.
  db.transaction((tx) => {
    tx.delete(modulesT).where(eq(modulesT.conceptId, concept.id)).run();
    tx.update(questionsT)
      .set({ retiredAt: now() })
      .where(
        and(eq(questionsT.conceptId, concept.id), isNull(questionsT.retiredAt)),
      )
      .run();
    tx.insert(modulesT)
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
    for (const row of questionRows) tx.insert(questionsT).values(row).run();
  });

  return moduleId;
}

// --- propose updates from new material ---------------------------------------

/**
 * Read material added to a finished course and store what it would change as
 * pending proposals. Storing is all this does: applying is the author's click,
 * per proposal, on the course page.
 */
const proposeUpdatesHandler: JobHandler = async (payload) => {
  const id = courseId(payload);
  const raw = (payload as { sourceIds?: unknown }).sourceIds;
  const sourceIds = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string")
    : [];
  if (sourceIds.length === 0) {
    throw new Error("propose_updates: payload missing sourceIds");
  }

  const course = db.select().from(coursesT).where(eq(coursesT.id, id)).get();
  if (!course) throw new Error("propose_updates: course not found");

  const material = sourceTexts(sourceIds);
  if (!material) {
    // The route checks before queuing, so reaching this means the sources were
    // deleted in between. Nothing to read, nothing to propose.
    return { proposals: 0, skipped: "no readable text" };
  }

  const concepts = db
    .select()
    .from(conceptsT)
    .where(and(eq(conceptsT.courseId, id), isNull(conceptsT.retiredAt)))
    .orderBy(asc(conceptsT.topoOrder))
    .all();
  const conceptList = concepts
    .map((c, i) => `${i}. ${c.title}: ${c.summary}`)
    .join("\n");

  const result = await runProposeUpdates(
    {
      lang: course.lang,
      objective: course.objective ?? course.sourcePrompt,
      conceptList,
      material,
    },
    id,
  );

  const stored = recordProposals(
    id,
    result.proposals,
    concepts.map((c) => ({ id: c.id, title: c.title })),
  );
  return { proposals: stored };
};

// --- preflight: does the selected model hold up against these prompts --------

/**
 * One pass through the pipeline on a fixture. A job rather than a request
 * because it is a minute of model calls, and the report goes in the job result
 * so the page that asked can poll for it like any other piece of work.
 */
const preflightHandler: JobHandler = async (payload) => {
  const runId = (payload as { runId?: unknown }).runId;
  if (typeof runId !== "string") throw new Error("preflight: payload missing runId");
  return runPreflight(preflightTag(runId));
};

export const HANDLERS: Record<string, JobHandler> = {
  preflight: preflightHandler,
  interview_questions: interviewHandler,
  intake: intakeHandler,
  build_graph: buildGraphHandler,
  generate_course: generateCourseHandler,
  regenerate_module: regenerateModuleHandler,
  propose_updates: proposeUpdatesHandler,
};
