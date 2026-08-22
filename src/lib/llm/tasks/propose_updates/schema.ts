import { z } from "zod";
import { ciEnum } from "@/lib/llm/zod";

/**
 * propose_updates output: what the new material would change in the course.
 * Every item is a suggestion for the author to approve or dismiss; nothing in
 * this shape applies itself.
 */
export const proposalItemSchema = z.object({
  kind: ciEnum([
    "update_module",
    "add_concept",
    "retire_concept",
    "place_figure",
  ]),
  /** Index into the numbered concept list in the prompt; null for add_concept. */
  conceptIndex: z.number().int().min(0).nullable(),
  /**
   * place_figure only: which picture, as an index into the numbered picture
   * list in the prompt, and which one it takes the place of.
   *
   * Separate from `conceptIndex` because the two lists are different lists, and
   * a single index field would have made a wrong number impossible to notice.
   */
  figureIndex: z.number().int().min(0).nullable().optional(),
  /** place_figure only: the picture this one supersedes, if it supersedes one. */
  replacesFigureIndex: z.number().int().min(0).nullable().optional(),
  /** add_concept only: the new concept, in the shape intake produces. */
  candidate: z
    .object({
      title: z.string().min(1),
      summary: z.string().min(1),
      priority: ciEnum(["critical", "high", "medium", "low"]),
      estimatedMinutes: z.number().int().positive().max(600),
      depthLevel: z.number().int().min(0).max(3),
    })
    .nullable()
    .optional(),
  /** What in the new material warrants this, concretely. */
  reason: z.string().min(1),
});

export const proposeUpdatesSchema = z.object({
  proposals: z.array(proposalItemSchema).max(12),
});

export type ProposeUpdatesResult = z.infer<typeof proposeUpdatesSchema>;
export type ProposalItem = z.infer<typeof proposalItemSchema>;
