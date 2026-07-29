import { z } from "zod";

/**
 * write_module output: the module title and its body as markdown following the
 * house module anatomy. The body is markdown so it can carry tables, config
 * snippets, and ASCII diagrams. Tests are NOT included here (they are a
 * separate task). Structure is verified by the eval harness, not self-reported.
 */
export const moduleSchema = z.object({
  title: z.string().min(1),
  // A floor, not a quality bar. A legitimately concise depth-0 module used to
  // fail validation at 400 and burn every retry, each one re-sending the prior
  // output, so the cheapest module became the most expensive. Length is judged
  // by the depth-aware soft check in verify.ts instead.
  bodyMd: z.string().min(200),
});

export type ModuleResult = z.infer<typeof moduleSchema>;
