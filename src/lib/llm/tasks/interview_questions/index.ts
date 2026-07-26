import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { interviewSchema, type InterviewResult } from "./schema";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

/** Generate the authoring interview questions from the pasted material. */
export async function runInterviewQuestions(
  material: string,
  courseId?: string,
): Promise<InterviewResult> {
  return runStructuredTask({
    task: "interview_questions",
    promptPath: PROMPT_PATH,
    vars: { material },
    schema: interviewSchema,
    courseId,
    temperature: 0.4,
    maxTokens: 1500,
  });
}

export {
  interviewSchema,
  type InterviewResult,
  type InterviewQuestion,
  type InterviewState,
} from "./schema";
