import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";
import {
  moduleBodyMessage,
  untrustedMaterialMessage,
} from "@/lib/llm/material";
import { concretenessSchema, type ConcretenessResult } from "./schema";
import { applyConcretenessEdits } from "./apply";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

export interface ConcretenessArgs {
  lang: string;
  concretenessRule: string;
  conceptTitle: string;
  sourcePrompt: string;
  bodyMd: string;
  /** The excerpts the module was written from; the only facts it may add. */
  sources: string;
}

/**
 * concreteness_pass stage: make the module physical, or say plainly that it is
 * not, by returning the edits rather than the module remade.
 *
 * Back to JSON here, having moved away from it a release ago. That was not a
 * mistake reversed: the delimiter format is right for an answer that is one
 * long markdown body, and it was the right fix while this stage produced one.
 * Changing the shape of the answer is the better fix, and a short list of
 * replacements is exactly what JSON is for.
 */
export async function runConcretenessPass(
  args: ConcretenessArgs,
  courseId?: string,
): Promise<ConcretenessResult> {
  const out = await runStructuredTask({
    task: "concreteness_pass",
    promptPath: PROMPT_PATH,
    vars: {
      lang: args.lang,
      concretenessRule: args.concretenessRule,
      conceptTitle: args.conceptTitle,
      sourcePrompt: args.sourcePrompt,
    },
    // The prompt tells this stage that every name it writes must exist in the
    // material. It was never given the material: asked to be concrete with
    // nothing to be concrete from, the only way to comply is to invent, and an
    // invented hostname reads exactly like a real one.
    extraMessages: [
      moduleBodyMessage(args.bodyMd),
      ...(args.sources ? [untrustedMaterialMessage(args.sources)] : []),
    ],
    schema: concretenessSchema,
    courseId,
    temperature: 0.4,
    maxTokens: OUTPUT_CAPS.concreteness_pass,
  });
  return applyConcretenessEdits(args.bodyMd, out);
}

export { concretenessSchema, type ConcretenessResult } from "./schema";
export { applyConcretenessEdits, editsAreTrustworthy } from "./apply";
