import { runEvalJudge } from "@/lib/llm/tasks/eval_judge";
import { runRubrics, type ModuleContext, type RubricReport } from "./rubrics";
import type { JudgeResult } from "@/lib/llm/tasks/eval_judge/schema";

export interface EvalReport {
  score: number;
  pass: boolean;
  rubrics: RubricReport;
  judge: JudgeResult | null;
  judgeError?: string;
}

/**
 * Evaluate a generated module: mechanical rubrics (always) + LLM judge (best
 * effort). A module that fails is regenerated, not published. The specificity
 * gate, a judge specificity violation, and anything the module states that the
 * material does not, all fail it.
 *
 * `sources` is the material the module was written from. Without it the judge
 * could only ask whether the text sounded specific, which rewards a confident
 * invention over an honest gap.
 */
export async function evalModule(
  bodyMd: string,
  ctx: ModuleContext,
  judgeArgs: { sourcePrompt: string; conceptTitle: string; sources: string },
  courseId?: string,
): Promise<EvalReport> {
  const rubrics = runRubrics(bodyMd, ctx);

  let judge: JudgeResult | null = null;
  let judgeError: string | undefined;
  // Only worth asking the judge when the mechanical gate passed: a module that
  // already failed the rubrics is regenerated regardless of the judge, so
  // calling it there is spend with no effect on the outcome.
  if (rubrics.pass) {
    try {
      judge = await runEvalJudge({ ...judgeArgs, bodyMd }, courseId);
    } catch (err) {
      // If no judge is configured/reachable, fall back to mechanical rubrics.
      judgeError = err instanceof Error ? err.message : String(err);
    }
  }

  const judgePass = judge
    ? judge.pass &&
      judge.specificityViolations.length === 0 &&
      judge.groundingViolations.length === 0
    : true;
  const pass = rubrics.pass && judgePass;
  const score = judge ? (rubrics.score + judge.score) / 2 : rubrics.score;

  return { score, pass, rubrics, judge, judgeError };
}

export { runRubrics, type ModuleContext, type RubricReport } from "./rubrics";
