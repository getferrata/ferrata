import { getLogger } from "@/lib/log";
import { runIntake } from "@/lib/llm/tasks/intake";
import { runBuildGraph } from "@/lib/llm/tasks/build_graph";
import { runWriteModule, verifyModule } from "@/lib/llm/tasks/write_module";
import { runConcretenessPass } from "@/lib/llm/tasks/concreteness_pass";
import { runEvalJudge } from "@/lib/llm/tasks/eval_judge";
import { runWriteQuestions } from "@/lib/llm/tasks/write_questions";
import { runSchedule } from "@/lib/llm/tasks/schedule";
import { runGlossary } from "@/lib/llm/tasks/glossary";
import { buildReport, type PreflightReport } from "./report";
import {
  PREFLIGHT_BRIEF,
  PREFLIGHT_CONCEPT,
  PREFLIGHT_COURSE,
  PREFLIGHT_MATERIAL,
} from "./fixture";

const log = getLogger("preflight");

/**
 * One pass through the real pipeline on a fixture, to answer a question the
 * connection test cannot: not "does the provider reply" but "does this model
 * hold up against these prompts".
 *
 * It matters because most of what a stage asks for is a convention, not an API
 * feature. Three stages now want a body after a `---BODY---` marker instead of
 * a JSON string, every stage has an output ceiling, and a model that ignores
 * the first or writes past the second turns into calls that are billed and
 * thrown away. Without this, an operator finds that out partway through a
 * course they are already paying for.
 *
 * The fixture is a few hundred tokens, so the whole check costs a fraction of a
 * cent even on an expensive model.
 */

export const PREFLIGHT_STAGES = [
  "intake",
  "build_graph",
  "write_module",
  "concreteness_pass",
  "eval_judge",
  "write_questions",
  "schedule",
  "glossary",
] as const;

/** Ledger tag for a preflight run. Not a course id: no course row exists. */
export function preflightTag(runId: string): string {
  return `preflight_${runId}`;
}

/**
 * Run every stage, recording rather than raising. A stage that throws is the
 * single most useful thing this can report, so it must not stop the ones after
 * it: an operator wants the whole picture from one run, not one failure at a
 * time down a list they pay for separately.
 */
export async function runPreflight(tag: string): Promise<PreflightReport> {
  const errors: { task: string; message: string }[] = [];
  const attempt = async <T>(task: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`preflight stage "${task}" failed: ${message}`);
      errors.push({ task, message });
      return null;
    }
  };

  const concept = PREFLIGHT_CONCEPT;
  const course = PREFLIGHT_COURSE;

  await attempt("intake", () =>
    runIntake(PREFLIGHT_BRIEF, PREFLIGHT_MATERIAL, "", tag),
  );

  // The graph runs on the fixture's own concepts, not on whatever intake
  // proposed. A preflight that costs a different amount every time it runs
  // cannot be used to compare one model against another.
  await attempt("build_graph", () =>
    runBuildGraph(
      {
        objective: course.objective,
        domain: course.domain,
        startLevel: course.startLevel,
        concepts: [
          { title: concept.title, summary: concept.summary },
          {
            title: "Descaling on schedule",
            summary: "Every 400 shots, counted by the machine itself.",
          },
        ],
      },
      tag,
    ),
  );

  const drafted = await attempt("write_module", () =>
    runWriteModule(
      {
        lang: course.lang,
        objective: course.objective,
        domain: course.domain,
        startLevel: course.startLevel,
        sourcePrompt: PREFLIGHT_BRIEF,
        concretenessRule: course.concretenessRule,
        conceptTitle: concept.title,
        conceptSummary: concept.summary,
        depthLevel: concept.depthLevel,
        prerequisites: [],
        sources: PREFLIGHT_MATERIAL,
      },
      tag,
    ),
  );

  // Downstream stages need a body. If the writer failed there is nothing
  // honest to feed them, so the fixture's own material stands in: they are
  // still exercised, and the writer's failure is already recorded.
  const bodyMd = drafted?.bodyMd ?? PREFLIGHT_MATERIAL;

  const concrete = await attempt("concreteness_pass", () =>
    runConcretenessPass(
      {
        lang: course.lang,
        concretenessRule: course.concretenessRule,
        conceptTitle: concept.title,
        sourcePrompt: PREFLIGHT_BRIEF,
        bodyMd,
        sources: PREFLIGHT_MATERIAL,
      },
      tag,
    ),
  );
  const finalBody = concrete?.bodyMd ?? bodyMd;

  await attempt("eval_judge", () =>
    runEvalJudge(
      {
        sourcePrompt: PREFLIGHT_BRIEF,
        conceptTitle: concept.title,
        bodyMd: finalBody,
        sources: PREFLIGHT_MATERIAL,
      },
      tag,
    ),
  );

  await attempt("write_questions", () =>
    runWriteQuestions(
      {
        lang: course.lang,
        conceptTitle: concept.title,
        bodyMd: finalBody,
        depthLevel: concept.depthLevel,
        sourcePrompt: PREFLIGHT_BRIEF,
        count: 3,
      },
      tag,
    ),
  );

  await attempt("schedule", () =>
    runSchedule(
      {
        lang: course.lang,
        deadline: "",
        budgetMinutes: 60,
        modules: [
          {
            title: concept.title,
            priority: "high",
            estimatedMinutes: 20,
            depthLevel: concept.depthLevel,
          },
        ],
      },
      tag,
    ),
  );

  await attempt("glossary", () =>
    runGlossary(
      {
        lang: course.lang,
        objective: course.objective,
        modules: [{ title: concept.title, summary: concept.summary }],
        sources: PREFLIGHT_MATERIAL,
      },
      tag,
    ),
  );

  const report = buildReport(tag, [...PREFLIGHT_STAGES], errors);

  // The deterministic checks the pipeline runs on every real module, run here
  // too: a model can satisfy every schema and still cite a source that does not
  // exist, and that is worth knowing before a course is paid for.
  if (drafted) {
    const v = verifyModule({
      bodyMd: finalBody,
      sources: [
        {
          sourceId: "preflight",
          sourceName: "runbook.md",
          ord: 0,
          text: PREFLIGHT_MATERIAL,
          score: 1,
        },
      ],
      depthLevel: concept.depthLevel,
    });
    for (const hard of v.hard) {
      report.errors.push({ task: "write_module", message: hard });
    }
    if (v.hard.length > 0 && report.verdict !== "broken") {
      report.verdict = "wasteful";
    }
  }

  return report;
}

export { buildReport } from "./report";
export type {
  PreflightReport,
  StageReport,
  Verdict,
} from "./report";
