import { z } from "zod";

/**
 * The authoring interview. A few targeted questions, generated from
 * the material, that surface the tacit context an author never writes into an
 * empty textarea. `why` tells the author what each answer sharpens in the plan.
 */
export const interviewSchema = z.object({
  questions: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        question: z.string().min(1),
        why: z.string().min(1),
      }),
    )
    .min(2)
    .max(6),
});

export type InterviewResult = z.infer<typeof interviewSchema>;
export type InterviewQuestion = InterviewResult["questions"][number];

/** What is stored in courses.interview_json. */
export interface InterviewState {
  questions: InterviewQuestion[];
  answers: Record<string, string>;
}
