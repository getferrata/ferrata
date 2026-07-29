import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runStructuredTask } from "@/lib/llm/run";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";
import { graphSchema, type GraphResult } from "./schema";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

export interface GraphConceptInput {
  title: string;
  summary: string;
}

/** build_graph stage: candidate concepts → prerequisite edges. */
export async function runBuildGraph(
  args: {
    objective: string;
    domain: string;
    startLevel: string;
    concepts: GraphConceptInput[];
  },
  courseId?: string,
): Promise<GraphResult> {
  const conceptList = args.concepts
    .map((c, i) => `${i}. ${c.title}: ${c.summary}`)
    .join("\n");

  return runStructuredTask({
    task: "build_graph",
    promptPath: PROMPT_PATH,
    vars: {
      objective: args.objective,
      domain: args.domain,
      startLevel: args.startLevel,
      conceptList,
    },
    schema: graphSchema,
    courseId,
    temperature: 0.2,
    maxTokens: OUTPUT_CAPS.build_graph,
  });
}

export { graphSchema, type GraphResult } from "./schema";
