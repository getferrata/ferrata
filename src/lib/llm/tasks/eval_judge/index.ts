import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { judgeSchema, normaliseJudge, type JudgeResult } from "./schema";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

export async function runEvalJudge(
  args: {
    sourcePrompt: string;
    conceptTitle: string;
    bodyMd: string;
    sources: string;
  },
  courseId?: string,
): Promise<JudgeResult> {
  const raw = await runStructuredTask({
    task: "eval_judge",
    promptPath: PROMPT_PATH,
    vars: {
      sourcePrompt: args.sourcePrompt,
      conceptTitle: args.conceptTitle,
      bodyMd: args.bodyMd,
      sources: args.sources || "(no material was attached: judge against the brief and general knowledge only)",
    },
    schema: judgeSchema,
    courseId,
    temperature: 0.1,
    maxTokens: 2000,
  });
  return normaliseJudge(raw);
}

export { judgeSchema, type JudgeResult } from "./schema";
