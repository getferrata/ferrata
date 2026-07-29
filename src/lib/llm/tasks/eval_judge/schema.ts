import { z } from "zod";

/**
 * How many entries of each list are kept. A ceiling on what the repair step is
 * asked to act on, not a validation rule: a judge that lists thirty-one problems
 * has done its job, and rejecting that verdict used to cost a full second call
 * to be told the same thing more briefly. Extra entries are dropped in
 * `normaliseJudge` instead.
 */
const MAX_ENTRIES = 30;

/** eval_judge output: the nuanced quality verdict on a module. */
export const judgeSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(1),
  issues: z.array(z.string()),
  /** Paragraphs that would read identically in a course on another subject. */
  specificityViolations: z.array(z.string()),
  /**
   * Facts the module states that the material does not support. Invented tool
   * names are the common case, and the most damaging: they read as insider
   * knowledge and cannot be told apart from the parts that are true.
   */
  groundingViolations: z.array(z.string()).optional(),
});

type JudgeRaw = z.infer<typeof judgeSchema>;

/**
 * `groundingViolations` is optional on the wire so an older prompt or a model
 * that drops the key costs a normalisation rather than a paid retry, but every
 * caller sees a list.
 */
export interface JudgeResult extends Omit<JudgeRaw, "groundingViolations"> {
  groundingViolations: string[];
}

export function normaliseJudge(raw: JudgeRaw): JudgeResult {
  return {
    ...raw,
    issues: raw.issues.slice(0, MAX_ENTRIES),
    specificityViolations: raw.specificityViolations.slice(0, MAX_ENTRIES),
    groundingViolations: (raw.groundingViolations ?? []).slice(0, MAX_ENTRIES),
  };
}
