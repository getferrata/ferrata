import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";
import { untrustedMaterialMessage } from "@/lib/llm/material";
import { interviewSchema, type InterviewResult } from "./schema";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

/**
 * Generate the authoring interview questions.
 *
 * Takes the brief AND an overview of whatever was attached. Without the second,
 * the stage asked the author to describe material they had already handed over,
 * spending one of a handful of questions on something the pipeline could see for
 * itself. The questions exist to extract what the material does NOT contain, so
 * knowing what it does contain is the whole point.
 */
export async function runInterviewQuestions(
  brief: string,
  materialOverview: string,
  courseId?: string,
): Promise<InterviewResult> {
  return runStructuredTask({
    task: "interview_questions",
    promptPath: PROMPT_PATH,
    vars: { brief },
    // Imported and untrusted: the material rides in a user turn, not the prompt.
    extraMessages: materialOverview
      ? [untrustedMaterialMessage(materialOverview)]
      : undefined,
    schema: interviewSchema,
    courseId,
    temperature: 0.4,
    maxTokens: OUTPUT_CAPS.interview_questions,
  });
}

export {
  interviewSchema,
  type InterviewResult,
  type InterviewQuestion,
  type InterviewState,
} from "./schema";
