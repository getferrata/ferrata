import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { moduleSchema, type ModuleResult } from "./schema";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

export interface WriteModuleArgs {
  lang: string;
  objective: string;
  domain: string;
  startLevel: string;
  sourcePrompt: string;
  concretenessRule: string;
  conceptTitle: string;
  conceptSummary: string;
  depthLevel: number;
  prerequisites: string[];
  /** Retrieved source excerpts to ground on + cite; empty if none attached. */
  sources: string;
  /** Course-level depth guidance (how much to explain inline). */
  depthGuidance?: string;
}

/** write_module stage: generate one module body in the house module anatomy. */
export async function runWriteModule(
  args: WriteModuleArgs,
  courseId?: string,
): Promise<ModuleResult> {
  return runStructuredTask({
    task: "write_module",
    promptPath: PROMPT_PATH,
    vars: {
      lang: args.lang,
      objective: args.objective,
      domain: args.domain,
      startLevel: args.startLevel,
      sourcePrompt: args.sourcePrompt,
      concretenessRule: args.concretenessRule,
      conceptTitle: args.conceptTitle,
      conceptSummary: args.conceptSummary,
      depthLevel: String(args.depthLevel),
      depthGuidance: args.depthGuidance ?? "",
      prerequisites: args.prerequisites.length
        ? args.prerequisites.join(", ")
        : "(nessuno)",
      sources:
        args.sources ||
        "(nessun materiale allegato: usa la tua conoscenza del dominio)",
    },
    schema: moduleSchema,
    courseId,
    temperature: 0.6,
    maxTokens: 4096,
  });
}

export { moduleSchema, type ModuleResult } from "./schema";
