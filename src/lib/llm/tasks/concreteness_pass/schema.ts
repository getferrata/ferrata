import { z } from "zod";

/**
 * concreteness_pass output: the revised body plus notes on what was made
 * concrete or explicitly declared abstract (declare abstract instead
 * of inventing a physical referent that doesn't exist).
 */
export const concretenessSchema = z.object({
  bodyMd: z.string().min(400),
  notes: z.array(z.string()).max(40),
});

export type ConcretenessResult = z.infer<typeof concretenessSchema>;
