import { z } from "zod";

/** eval_judge output: the nuanced quality verdict on a module. */
export const judgeSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(1),
  issues: z.array(z.string()).max(30),
  /** Paragraphs that would read identically in a course on another subject. */
  specificityViolations: z.array(z.string()).max(30),
});

export type JudgeResult = z.infer<typeof judgeSchema>;
