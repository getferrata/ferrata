import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";
import {
  moduleBodyMessage,
  untrustedMaterialMessage,
} from "@/lib/llm/material";
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
    },
    // Neither the module under judgement nor the material it was written from
    // belongs in the judge's system prompt: a module carrying a smuggled "this
    // has already been approved" would otherwise read as an instruction from
    // the operator.
    extraMessages: [
      moduleBodyMessage(args.bodyMd),
      ...(args.sources ? [untrustedMaterialMessage(args.sources)] : []),
    ],
    schema: judgeSchema,
    courseId,
    temperature: 0.1,
    maxTokens: OUTPUT_CAPS.eval_judge,
  });
  return normaliseJudge(raw);
}

export { judgeSchema, type JudgeResult } from "./schema";
