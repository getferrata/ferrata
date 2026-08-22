import { z } from "zod";

/**
 * concreteness_pass output: the edits to make, not the module remade.
 *
 * This stage used to re-emit the whole body, which on the first hosted-model
 * run made it the most expensive stage in the pipeline: roughly 2600 output
 * tokens to rewrite a text that was already in its own input, while its prompt
 * said in as many words that this is an edit and not a rewrite. Output costs
 * five times input on a strong model, so the shape of the answer was most of
 * the bill.
 *
 * A list of replacements says the same thing in a few hundred tokens, and says
 * it more precisely: an edit either matches the text it claims to change or it
 * does not, and that is checkable. A rewritten body can quietly drop a table
 * and nothing notices.
 */
export const concretenessSchema = z.object({
  edits: z
    .array(
      z.object({
        /** The exact text to replace. Must appear once in the body. */
        find: z.string().min(1),
        /** What to put there. Empty removes the passage. */
        replace: z.string(),
        /** What this made concrete, or why it was declared abstract. */
        why: z.string().default(""),
      }),
    )
    // No minimum. A module that is already concrete should say so by editing
    // nothing, rather than inventing a change to look busy.
    .max(60),
  notes: z
    .array(z.string())
    .default([])
    .transform((n) => n.slice(0, 40)),
});

export type ConcretenessEdits = z.infer<typeof concretenessSchema>;

/** What the stage hands back once its edits have been applied to the body. */
export interface ConcretenessResult {
  bodyMd: string;
  notes: string[];
  /** Edits that matched and were made. */
  applied: number;
  /** Edits that matched nothing, or matched in more than one place. */
  rejected: {
    find: string;
    reason: "not found" | "ambiguous" | "drops a placeholder";
  }[];
}
