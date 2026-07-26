import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { intakeSchema, type IntakeResult } from "./schema";

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "prompt.md",
);

/**
 * Intake stage: author material + interview answers -> structured brief.
 * Detects language, reframes the objective honestly, picks the
 * per-domain concreteness rule, and lists candidate concepts.
 */
export async function runIntake(
  material: string,
  authorContext: string,
  courseId?: string,
  depthGuidance = "",
): Promise<IntakeResult> {
  return runStructuredTask({
    task: "intake",
    promptPath: PROMPT_PATH,
    vars: {
      material,
      authorContext: authorContext || "(nessuna risposta)",
      depthGuidance,
    },
    schema: intakeSchema,
    courseId,
    temperature: 0.3,
    maxTokens: 4096,
  });
}

export { intakeSchema, type IntakeResult } from "./schema";
