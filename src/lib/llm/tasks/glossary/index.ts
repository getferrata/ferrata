import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";
import { bodyOnlyParser } from "@/lib/llm/tasks/body_delimiter";
import { untrustedMaterialMessage } from "@/lib/llm/material";
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
    /** Overview of the attached material, so terms are defined as it uses them. */
    sources?: string;
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
    // Titles and summaries say which terms matter; only the material says what
    // they mean HERE. Without it a glossary defines the general sense of a word
    // the course uses in a particular one, which is worse than no entry.
    extraMessages: args.sources
      ? [untrustedMaterialMessage(args.sources)]
      : undefined,
    schema: glossarySchema,
    courseId,
    temperature: 0.4,
    maxTokens: OUTPUT_CAPS.glossary,
    // One long markdown document, so it stays out of JSON: same reason
    // as write_module and the concreteness pass.
    jsonMode: false,
    parse: bodyOnlyParser("glossaryMd"),
    formatName:
      "the required format (a line with ---BODY---, then the markdown)",
  });
}

export { glossarySchema, type GlossaryResult } from "./schema";
