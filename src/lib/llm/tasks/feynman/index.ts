import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { feynmanSchema, type FeynmanResult } from "./schema";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

export async function runFeynman(
  args: {
    lang: string;
    conceptTitle: string;
    bodyMd: string;
    explanation: string;
  },
  courseId?: string,
): Promise<FeynmanResult> {
  return runStructuredTask({
    task: "feynman",
    promptPath: PROMPT_PATH,
    vars: {
      lang: args.lang,
      conceptTitle: args.conceptTitle,
      bodyMd: args.bodyMd,
      explanation: args.explanation,
    },
    schema: feynmanSchema,
    courseId,
    temperature: 0.3,
    maxTokens: 800,
  });
}

export { feynmanSchema, type FeynmanResult } from "./schema";
