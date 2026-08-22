import { createHash } from "node:crypto";
import { z } from "zod";
import type { CourseBundle } from "@/lib/course/query";
import { isWellKnownAddress } from "@/lib/sources/well-known";

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
  /**
   * Approved figures, base64, so a course that teaches from a diagram still
   * teaches from it after being exported and imported somewhere else.
   *
   * Only the approved ones travel, and they arrive pending at the other end.
   * The gate on a picture is a person looking at it, and the person who looked
   * at this one works somewhere else: a diagram that was fine to show inside
   * the company that wrote it is not automatically fine to show inside the one
   * that received the package.
   *
   * Optional so a package written before this existed still parses.
   */
  figures: z
    .array(
      z.object({
        sha256: z.string().min(8).max(64),
        mime: z.string().min(3).max(60),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        altText: z.string().nullable(),
        /** The bytes. Bounded here as well as at export, since this parses input. */
        dataBase64: z.string().max(16_000_000),
      }),
    )
    .max(200)
    .optional(),
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
/**
 * How much of the package the pictures may take.
 *
 * A course is a file people send each other, and a diagram at full camera
 * resolution is bigger than every word of the course put together. Past this,
 * the rest are left out, and the count says so rather than the package quietly
 * arriving short.
 */
export const FIGURE_BUDGET_BYTES = 8 * 1024 * 1024;

/**
 * Pack what fits, in the order given, and stop rather than truncate.
 *
 * Stopping at a whole picture keeps every one that travels intact. Splitting
 * the budget across all of them, or cutting the last one short, would produce a
 * package whose images are bytes that decode to nothing.
 */
function packFigures(
  figures: ExportableFigure[],
): NonNullable<FerrataPackage["figures"]> {
  const out: NonNullable<FerrataPackage["figures"]> = [];
  let spent = 0;
  for (const f of figures) {
    // Base64 is a third larger than the bytes, and the budget is on what the
    // package actually weighs.
    const cost = Math.ceil((f.data.length * 4) / 3);
    if (spent + cost > FIGURE_BUDGET_BYTES) break;
    spent += cost;
    out.push({
      sha256: f.sha256,
      mime: f.mime,
      width: f.width,
      height: f.height,
      altText: f.altText,
      dataBase64: f.data.toString("base64"),
    });
  }
  return out;
}

export interface ExportableFigure {
  sha256: string;
  mime: string;
  width: number;
  height: number;
  altText: string | null;
  data: Buffer;
}

export function buildPackage(
  bundle: CourseBundle,
  opts: {
    author?: string | null;
    license?: string | null;
    exportedAt: number;
    /** Approved figures only. The caller decides that; this only packs them. */
    figures?: ExportableFigure[];
  },
): FerrataPackage {
  const { course, modules, edges, cuts } = bundle;
  const context = course.authorContextMd ?? course.sourcePrompt;

  const pkg: FerrataPackage = {
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
    figures: packFigures(opts.figures ?? []),
  };

  assertNoProtectedValues(pkg, bundle.restorations);
  return pkg;
}

/**
 * Refuse to hand out a package that carries a Contextia-protected value.
 *
 * The pipeline already keeps them out: the model only ever sees the ⟨cxt:hash⟩
 * placeholder, so a module cannot hold the real host unless something upstream
 * changed. Checking here is cheap, and it sits inside buildPackage rather than
 * beside one of its callers because the two export routes are easy to guard
 * unevenly. It turns "we tested that it does not leak" into "it cannot leak
 * without the export failing".
 */
export function assertNoProtectedValues(
  pkg: FerrataPackage,
  restorations: readonly { value: string; label: string }[],
): void {
  if (restorations.length === 0) return;
  const serialised = JSON.stringify(pkg);
  const leaked = restorations.filter(
    (r) =>
      r.value.length > 3 &&
      // A published constant in a module is not a leak, whether or not
      // something once decided to protect it. The allowlist at detection stops
      // the next course tokenizing these; this is what a course already built
      // needs, because the alternative is paying to write it again.
      !isWellKnownAddress(r.value) &&
      serialised.includes(r.value),
  );
  if (leaked.length === 0) return;
  throw new Error(
    `Export refused: the package would carry ${leaked.length} protected value(s) in clear (${leaked
      .map((r) => r.label)
      .join(", ")}). Nothing was written.`,
  );
}
