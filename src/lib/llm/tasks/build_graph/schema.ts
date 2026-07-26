import { z } from "zod";

/**
 * build_graph output: prerequisite edges between the candidate concepts,
 * expressed as index pairs into the provided list. `from` must be studied
 * before `to`. Cycles are broken downstream; the model is asked to avoid them.
 */
export const graphSchema = z.object({
  edges: z
    .array(
      z.object({
        fromIndex: z.number().int().min(0),
        toIndex: z.number().int().min(0),
        reason: z.string().min(1),
      }),
    )
    .max(200),
});

export type GraphResult = z.infer<typeof graphSchema>;
