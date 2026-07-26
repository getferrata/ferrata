import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { scheduleSchema, type ScheduleResult } from "./schema";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

export interface ScheduleModuleInput {
  title: string;
  priority: string;
  estimatedMinutes: number;
  depthLevel: number;
}

export async function runSchedule(
  args: {
    lang: string;
    deadline: string;
    budgetMinutes: number | null;
    modules: ScheduleModuleInput[];
  },
  courseId?: string,
): Promise<ScheduleResult> {
  const moduleList = args.modules
    .map(
      (m) =>
        `- ${m.title}: ${m.priority}, ${m.estimatedMinutes} min, depth ${m.depthLevel}`,
    )
    .join("\n");

  return runStructuredTask({
    task: "schedule",
    promptPath: PROMPT_PATH,
    vars: {
      lang: args.lang,
      deadline: args.deadline || "(nessuna scadenza precisa)",
      budgetMinutes: args.budgetMinutes ? String(args.budgetMinutes) : "n/d",
      moduleList,
    },
    schema: scheduleSchema,
    courseId,
    temperature: 0.4,
    maxTokens: 1800,
  });
}

export { scheduleSchema, type ScheduleResult } from "./schema";
