import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";
import {
  moduleBodyMessage,
  untrustedMaterialMessage,
} from "@/lib/llm/material";
import { concretenessSchema, type ConcretenessResult } from "./schema";
import { parseConcretenessOutput } from "./format";

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

/** concreteness_pass stage: make the module physical or declare it abstract. */
export async function runConcretenessPass(
  args: ConcretenessArgs,
  courseId?: string,
): Promise<ConcretenessResult> {
  return runStructuredTask({
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
    // The body is long-form markdown, not JSON. Same reason as write_module.
    jsonMode: false,
    parse: parseConcretenessOutput,
    formatName:
      "the required format (a NOTES: block of one-line bullets, then a line with ---BODY---, then the markdown body)",
  });
}

export { concretenessSchema, type ConcretenessResult } from "./schema";
