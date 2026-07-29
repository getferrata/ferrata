import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";
import { untrustedMaterialMessage } from "@/lib/llm/material";
import { intakeSchema, type IntakeResult } from "./schema";

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "prompt.md",
);

/**
 * Intake stage: author brief + attached material + interview answers -> a
 * structured brief. Detects language, reframes the objective honestly, picks the
 * per-domain concreteness rule, and lists candidate concepts.
 *
 * The brief and interview answers are the author's own words (trusted, in the
 * system prompt); the attached material is imported and untrusted, so it rides
 * in a separate user turn.
 */
export async function runIntake(
  brief: string,
  materialOverview: string,
  authorContext: string,
  courseId?: string,
  depthGuidance = "",
): Promise<IntakeResult> {
  return runStructuredTask({
    task: "intake",
    promptPath: PROMPT_PATH,
    vars: {
      brief,
      authorContext: authorContext || "(no interview answers)",
      depthGuidance,
    },
    extraMessages: materialOverview
      ? [untrustedMaterialMessage(materialOverview)]
      : undefined,
    schema: intakeSchema,
    courseId,
    temperature: 0.3,
    maxTokens: OUTPUT_CAPS.intake,
  });
}

export { intakeSchema, type IntakeResult } from "./schema";
