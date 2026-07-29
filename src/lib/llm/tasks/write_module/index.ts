import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";
import { untrustedMaterialMessage } from "@/lib/llm/material";
import type { LlmMessage } from "@/lib/llm/provider";
import { moduleSchema, type ModuleResult } from "./schema";
import { parseModuleOutput } from "./format";

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

/**
 * A targeted repair of a prior draft: the body it produced plus the specific,
 * mostly deterministic problems to fix. Feeding a model its own output with an
 * exact list of defects works where a blind "try again" does not, because the
 * defects come from external checks, not the model's own judgement of itself.
 */
export interface RepairRequest {
  priorBody: string;
  notes: string[];
}

function repairMessage(repair: RepairRequest): LlmMessage {
  const list = repair.notes.map((n, i) => `${i + 1}. ${n}`).join("\n");
  return {
    role: "user",
    content:
      "Here is the module body you produced:\n\n---\n" +
      repair.priorBody +
      "\n---\n\nAutomated checks found these specific problems that must be " +
      "fixed:\n" +
      list +
      "\n\nReturn a corrected module in the required format, changing only what " +
      "is needed to fix these problems and keeping everything that is already good.",
  };
}

/** write_module stage: generate one module body in the house module anatomy. */
export async function runWriteModule(
  args: WriteModuleArgs,
  courseId?: string,
  repair?: RepairRequest,
): Promise<ModuleResult> {
  // The material is untrusted imported content, so it rides in a user turn
  // rather than the system prompt (see lib/llm/material). No material attached
  // means the model falls back to its own domain knowledge, as the prompt says.
  const extraMessages: LlmMessage[] = [];
  if (args.sources) extraMessages.push(untrustedMaterialMessage(args.sources));
  if (repair) extraMessages.push(repairMessage(repair));

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
        : "(none)",
    },
    extraMessages: extraMessages.length ? extraMessages : undefined,
    schema: moduleSchema,
    courseId,
    temperature: 0.6,
    maxTokens: OUTPUT_CAPS.write_module,
    // The body is long-form markdown, not JSON: a delimiter format keeps it raw
    // instead of paying the per-character escaping tax inside a JSON string.
    jsonMode: false,
    parse: parseModuleOutput,
    formatName: "the required format (a TITLE: line, then a line with ---BODY---, then the markdown body)",
  });
}

export { moduleSchema, type ModuleResult } from "./schema";
export { verifyModule, type VerifyResult } from "./verify";
