import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";
import { moduleBodyMessage } from "@/lib/llm/material";
import { questionsSchema, type QuestionsResult } from "./schema";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

export interface WriteQuestionsArgs {
  lang: string;
  conceptTitle: string;
  bodyMd: string;
  depthLevel: number;
  sourcePrompt: string;
  /** How many questions to write; derived from depth/length by the orchestrator. */
  count: number;
}

/** write_questions stage: inline tests for one module, Bloom-tuned to depth. */
export async function runWriteQuestions(
  args: WriteQuestionsArgs,
  courseId?: string,
): Promise<QuestionsResult> {
  return runStructuredTask({
    task: "write_questions",
    promptPath: PROMPT_PATH,
    vars: {
      lang: args.lang,
      conceptTitle: args.conceptTitle,
      depthLevel: String(args.depthLevel),
      sourcePrompt: args.sourcePrompt,
      count: String(args.count),
    },
    extraMessages: [moduleBodyMessage(args.bodyMd)],
    schema: questionsSchema,
    courseId,
    temperature: 0.5,
    maxTokens: OUTPUT_CAPS.write_questions,
  });
}

export { questionsSchema, type QuestionsResult } from "./schema";
