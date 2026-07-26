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
      options: z.array(z.string().min(1)).min(2).max(6),
      correctIndex: z.number().int().min(0),
    })
    .nullable()
    .optional(),
  misconceptions: z.array(z.string()).max(10),
});

export const questionsSchema = z.object({
  questions: z.array(questionSchema).min(1).max(20),
});

export type QuestionsResult = z.infer<typeof questionsSchema>;
export type GeneratedQuestion = z.infer<typeof questionSchema>;
