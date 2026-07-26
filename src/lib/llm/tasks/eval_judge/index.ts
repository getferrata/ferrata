import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { judgeSchema, type JudgeResult } from "./schema";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

export async function runEvalJudge(
  args: { sourcePrompt: string; conceptTitle: string; bodyMd: string },
  courseId?: string,
): Promise<JudgeResult> {
  return runStructuredTask({
    task: "eval_judge",
    promptPath: PROMPT_PATH,
    vars: {
      sourcePrompt: args.sourcePrompt,
      conceptTitle: args.conceptTitle,
      bodyMd: args.bodyMd,
    },
    schema: judgeSchema,
    courseId,
    temperature: 0.1,
    maxTokens: 1500,
  });
}

export { judgeSchema, type JudgeResult } from "./schema";
