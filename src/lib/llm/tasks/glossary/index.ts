import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { glossarySchema, type GlossaryResult } from "./schema";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

export interface GlossaryModuleInput {
  title: string;
  summary: string;
}

export async function runGlossary(
  args: {
    lang: string;
    objective: string;
    modules: GlossaryModuleInput[];
  },
  courseId?: string,
): Promise<GlossaryResult> {
  const moduleList = args.modules
    .map((m) => `- ${m.title}: ${m.summary}`)
    .join("\n");

  return runStructuredTask({
    task: "glossary",
    promptPath: PROMPT_PATH,
    vars: {
      lang: args.lang,
      objective: args.objective,
      moduleList,
    },
    schema: glossarySchema,
    courseId,
    temperature: 0.4,
    maxTokens: 2500,
  });
}

export { glossarySchema, type GlossaryResult } from "./schema";
