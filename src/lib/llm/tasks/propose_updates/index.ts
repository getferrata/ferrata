import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";
import { untrustedMaterialMessage } from "@/lib/llm/material";
import { proposeUpdatesSchema, type ProposeUpdatesResult } from "./schema";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

/**
 * Read new material against a finished course and propose what should change.
 * Proposals only: the author decides, so this task's output is a checklist,
 * never an action.
 */
export async function runProposeUpdates(
  args: {
    lang: string;
    objective: string;
    /** Numbered list of the course's concepts, one per line. */
    conceptList: string;
    /**
     * Numbered list of the course's pictures, new and existing.
     *
     * Rendered by the caller from describeFigures, because what identifies a
     * picture to a model that cannot see it is the document, the caption and
     * the prose around it, and assembling that is a database question rather
     * than a prompt one.
     */
    figureList: string;
    /** The new material's text, bounded by the caller. */
    material: string;
  },
  courseId?: string,
): Promise<ProposeUpdatesResult> {
  return runStructuredTask({
    task: "propose_updates",
    promptPath: PROMPT_PATH,
    vars: {
      lang: args.lang,
      objective: args.objective,
      conceptList: args.conceptList,
      figureList: args.figureList.trim() || "(this course has no pictures)",
    },
    // The newly added material is imported and untrusted: it rides in a user
    // turn, never the system prompt.
    extraMessages: args.material
      ? [untrustedMaterialMessage(args.material)]
      : undefined,
    schema: proposeUpdatesSchema,
    courseId,
    temperature: 0.2,
    maxTokens: OUTPUT_CAPS.propose_updates,
  });
}

export {
  proposeUpdatesSchema,
  type ProposeUpdatesResult,
  type ProposalItem,
} from "./schema";
