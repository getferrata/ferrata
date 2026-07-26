import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { concretenessSchema, type ConcretenessResult } from "./schema";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

export interface ConcretenessArgs {
  lang: string;
  concretenessRule: string;
  conceptTitle: string;
  sourcePrompt: string;
  bodyMd: string;
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
      bodyMd: args.bodyMd,
    },
    schema: concretenessSchema,
    courseId,
    temperature: 0.4,
    maxTokens: 4096,
  });
}

export { concretenessSchema, type ConcretenessResult } from "./schema";
