import { createHash } from "node:crypto";
import { z } from "zod";
import type { CourseBundle } from "@/lib/course/query";

/**
 * The portable course package: text-only, diffable, **no student
 * state**, regenerable. This module defines the canonical single-file shape and
 * a strict Zod schema. Every import is validated against it because a package
 * arrives from a stranger: imported content is untrusted.
 */

export const FERRATA_FORMAT = "ferrata" as const;
export const FERRATA_VERSION = 1 as const;

export const manifestSchema = z.object({
  format: z.literal(FERRATA_FORMAT),
  version: z.literal(FERRATA_VERSION),
  title: z.string().min(1).max(500),
  author: z.string().max(200).nullable(),
  lang: z.string().min(2).max(5),
  license: z.string().max(120).nullable(),
  sourceHash: z.string().max(128),
  exportedAt: z.number().int(),
  moduleCount: z.number().int().nonnegative(),
});

export const packageConceptSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  priority: z.enum(["critical", "high", "medium", "low"]),
  estimatedMinutes: z.number().int().nonnegative(),
  depthLevel: z.number().int().min(0).max(3),
  topoOrder: z.number().int().nullable(),
});

export const packageModuleSchema = z.object({
  conceptId: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["concept", "method", "meta"]),
  bodyMd: z.string(),
});

export const packageQuestionSchema = z.object({
  conceptId: z.string().min(1),
  prompt: z.string().min(1),
  expectedAnswer: z.string(),
  bloomLevel: z.enum([
    "remember",
    "understand",
    "apply",
    "analyze",
    "evaluate",
    "create",
  ]),
  format: z.enum(["open", "mcq", "cloze", "explain"]),
  optionsJson: z.string().nullable(),
  misconceptionsJson: z.string().nullable(),
});

export const ferrataPackageSchema = z.object({
  manifest: manifestSchema,
  /** Author context (destinatario, obiettivo, vincoli, tacit knowledge). */
  context: z.string(),
  objective: z.string().nullable(),
  domain: z.string().nullable(),
  concretenessRule: z.string().nullable(),
  startLevel: z.string().nullable(),
  scheduleMd: z.string().nullable(),
  glossaryMd: z.string().nullable(),
  budgetMinutes: z.number().int().nullable(),
  graph: z.object({
    concepts: z.array(packageConceptSchema).max(1000),
    edges: z
      .array(z.object({ from: z.string(), to: z.string() }))
      .max(5000),
  }),
  modules: z.array(packageModuleSchema).max(1000),
  questions: z.array(packageQuestionSchema).max(20000),
  cuts: z.array(z.object({ title: z.string(), reason: z.string() })).max(1000),
});

export type FerrataPackage = z.infer<typeof ferrataPackageSchema>;

/** sha256 of the source material, so a re-import can detect drift. */
export function sourceHashOf(sourcePrompt: string, authorContext: string): string {
  return createHash("sha256")
    .update(`${sourcePrompt}\n---\n${authorContext}`)
    .digest("hex");
}

/**
 * Build a package from a loaded course. Deliberately excludes reviews/FSRS:
 * student state never travels in the package.
 */
export function buildPackage(
  bundle: CourseBundle,
  opts: { author?: string | null; license?: string | null; exportedAt: number },
): FerrataPackage {
  const { course, modules, edges, cuts } = bundle;
  const context = course.authorContextMd ?? course.sourcePrompt;

  return {
    manifest: {
      format: FERRATA_FORMAT,
      version: FERRATA_VERSION,
      title: course.title,
      author: opts.author ?? null,
      lang: course.lang,
      license: opts.license ?? null,
      sourceHash: sourceHashOf(course.sourcePrompt, context),
      exportedAt: opts.exportedAt,
      moduleCount: modules.filter((m) => m.module?.bodyMd).length,
    },
    context,
    objective: course.objective,
    domain: course.domain,
    concretenessRule: course.concretenessRule,
    startLevel: course.startLevel,
    scheduleMd: course.scheduleMd,
    glossaryMd: course.glossaryMd,
    budgetMinutes: course.budgetMinutes,
    graph: {
      concepts: modules.map((m) => ({
        id: m.concept.id,
        title: m.concept.title,
        summary: m.concept.summary,
        priority: m.concept.priority,
        estimatedMinutes: m.concept.estimatedMinutes,
        depthLevel: m.concept.depthLevel,
        topoOrder: m.concept.topoOrder,
      })),
      edges,
    },
    modules: modules
      .filter((m) => m.module?.bodyMd)
      .map((m) => ({
        conceptId: m.concept.id,
        title: m.concept.title,
        kind: m.module?.kind ?? "concept",
        bodyMd: m.module?.bodyMd ?? "",
      })),
    questions: modules.flatMap((m) =>
      m.questions.map((q) => ({
        conceptId: m.concept.id,
        prompt: q.prompt,
        expectedAnswer: q.expectedAnswer,
        bloomLevel: q.bloomLevel,
        format: q.format,
        optionsJson: q.optionsJson,
        misconceptionsJson: q.misconceptionsJson,
      })),
    ),
    cuts: cuts.map((c) => ({ title: c.title, reason: c.reason })),
  };
}
