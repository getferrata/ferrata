import { z } from "zod";

/** glossary output: the course's flash glossary as markdown. */
export const glossarySchema = z.object({
  glossaryMd: z.string().min(80),
});

export type GlossaryResult = z.infer<typeof glossarySchema>;
