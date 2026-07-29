import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";
import { bodyOnlyParser } from "@/lib/llm/tasks/body_delimiter";
import { scheduleSchema, type ScheduleResult } from "./schema";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

export interface ScheduleModuleInput {
  title: string;
  priority: string;
  estimatedMinutes: number;
  depthLevel: number;
  /**
   * Titles this module must come after. The course builds a prerequisite graph
   * and shows the student the map that comes out of it; a plan free to reorder
   * without seeing the edges will contradict that map, and the student ends up
   * holding two orders with no way to tell which one is the route.
   */
  prerequisites?: string[];
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
    .map((m) => {
      const after = m.prerequisites?.length
        ? `, after: ${m.prerequisites.join("; ")}`
        : "";
      return `- ${m.title}: ${m.priority}, ${m.estimatedMinutes} min, depth ${m.depthLevel}${after}`;
    })
    .join("\n");
  // Given, not left to be counted. The plan has to say how much it cut, and a
  // model asked to both add up a column and respect a ceiling will assert it
  // did one while doing neither.
  const totalMinutes = args.modules.reduce(
    (n, m) => n + m.estimatedMinutes,
    0,
  );

  return runStructuredTask({
    task: "schedule",
    promptPath: PROMPT_PATH,
    vars: {
      lang: args.lang,
      deadline: args.deadline || "(nessuna scadenza precisa)",
      budgetMinutes: args.budgetMinutes ? String(args.budgetMinutes) : "n/d",
      totalMinutes: String(totalMinutes),
      overBy: args.budgetMinutes
        ? String(Math.max(0, totalMinutes - args.budgetMinutes))
        : "0",
      moduleList,
    },
    schema: scheduleSchema,
    courseId,
    temperature: 0.4,
    maxTokens: OUTPUT_CAPS.schedule,
    // One long markdown document, so it stays out of JSON: same reason
    // as write_module and the concreteness pass.
    jsonMode: false,
    parse: bodyOnlyParser("scheduleMd"),
    formatName:
      "the required format (a line with ---BODY---, then the markdown)",
  });
}

export { scheduleSchema, type ScheduleResult } from "./schema";
