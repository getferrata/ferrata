import { z } from "zod";

/**
 * feynman output: where the gap is, not a grade. `strengths` names
 * what the learner actually got; `gap` names the specific missing piece AND its
 * consequence ("without it you can't predict what happens when it breaks").
 */
export const feynmanSchema = z.object({
  strengths: z.string().min(1),
  gap: z.string().min(1),
  /** True only when the explanation has no meaningful gap left. */
  complete: z.boolean(),
});

export type FeynmanResult = z.infer<typeof feynmanSchema>;
