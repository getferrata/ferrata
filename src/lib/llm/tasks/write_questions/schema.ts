import { z } from "zod";
import { ciEnum } from "@/lib/llm/zod";

export const questionSchema = z.object({
  prompt: z.string().min(1),
  expectedAnswer: z.string().min(1),
  bloomLevel: ciEnum([
    "remember",
    "understand",
    "apply",
    "analyze",
    "evaluate",
    "create",
  ]),
  format: ciEnum(["open", "mcq", "cloze", "explain"]),
  /** Present for mcq: distractors must be plausible real errors, not absurd. */
  options: z
    .object({
      options: z.array(z.string().min(1)).min(2).max(8),
      correctIndex: z.number().int().min(0),
    })
    // correctIndex must point at an option that exists. A 1-based slip
    // (correctIndex 3 for 3 options) would otherwise store an mcq that grades
    // every answer wrong, and whose broken options let no answer through.
    .refine((o) => o.correctIndex < o.options.length, {
      message: "correctIndex is out of range for the options given",
    })
    .nullable()
    .optional(),
  /**
   * Present for cloze: one entry per blank, in prompt order, each listing the
   * wordings that count as right. Without it a cloze can only be graded by the
   * student, since expectedAnswer is prose written for a reader.
   */
  blanks: z
    .array(z.object({ accept: z.array(z.string().min(1)).min(1).max(8) }))
    .max(10)
    .nullable()
    .optional(),
  /**
   * The wrong answers worth naming. Optional on the wire and clamped rather
   * than capped, because neither omitting it nor being generous with it is a
   * reason to throw the batch away.
   *
   * This used to be required and capped at ten. A batch is one call: a model
   * that leaves the key off a single question, or lists eleven on one, cost a
   * whole set of questions and a second billed call to be asked again. The
   * correctness rule below is a different matter and stays: an mcq whose
   * correctIndex points past its options grades every answer wrong.
   */
  misconceptions: z
    .array(z.string())
    .default([])
    .transform((m) => m.slice(0, 10)),
});

export const questionsSchema = z.object({
  questions: z.array(questionSchema).min(1).max(40),
});

export type QuestionsResult = z.infer<typeof questionsSchema>;
export type GeneratedQuestion = z.infer<typeof questionSchema>;
