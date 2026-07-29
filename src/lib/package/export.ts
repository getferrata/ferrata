import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "@/db";
import { packages } from "@/db/schema";
import { newId, now } from "@/lib/util/id";
import type { CourseBundle } from "@/lib/course/query";
import { buildPackage, type FerrataPackage } from "./format";

export function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "corso"
  );
}

/**
 * Serialize a package to the directory layout (human-readable, diffable):
 *   manifest.json · context.md · graph.json · modules/*.md · questions.json ·
 *   cuts.json · sources/
 * Returns filename → content (writer-agnostic so it can be tested without fs).
 */
export function packageFiles(pkg: FerrataPackage): Record<string, string> {
  const files: Record<string, string> = {
    "manifest.json": JSON.stringify(pkg.manifest, null, 2),
    "context.md": pkg.context,
    "graph.json": JSON.stringify(pkg.graph, null, 2),
    "questions.json": JSON.stringify(pkg.questions, null, 2),
    "cuts.json": JSON.stringify(pkg.cuts, null, 2),
    "course.json": JSON.stringify(
      {
        objective: pkg.objective,
        domain: pkg.domain,
        concretenessRule: pkg.concretenessRule,
        startLevel: pkg.startLevel,
        scheduleMd: pkg.scheduleMd,
        glossaryMd: pkg.glossaryMd,
        budgetMinutes: pkg.budgetMinutes,
      },
      null,
      2,
    ),
    "sources/README.md":
      "Riferimenti alle fonti, non i file originali (copyright). Vuoto per ora.",
  };
  pkg.modules.forEach((m, i) => {
    const name = `modules/${String(i).padStart(2, "0")}-${slug(m.title)}.md`;
    files[name] = `---\nconceptId: ${m.conceptId}\nkind: ${m.kind}\ntitle: "${m.title.replace(/"/g, "'")}"\n---\n\n${m.bodyMd}`;
  });
  return files;
}

export interface ExportResult {
  dir: string;
  file: string;
  fileCount: number;
}

/**
 * Write a course package to disk: both the diffable directory and a single-file
 * `<slug>.ferrata.json` for easy transport. Records a
 * `packages` row (trusted, because it is self-generated).
 */
export async function writePackage(
  bundle: CourseBundle,
  opts: { author?: string | null; license?: string | null } = {},
  // In Docker the working directory is the app dir, so default exports landed
  // inside the image. FERRATA_EXPORT_DIR lets an operator point them at a mount.
  baseDir = process.env.FERRATA_EXPORT_DIR
    ? resolve(process.env.FERRATA_EXPORT_DIR)
    : resolve(process.cwd(), "exports"),
): Promise<ExportResult> {
  const pkg = buildPackage(bundle, {
    author: opts.author ?? null,
    license: opts.license ?? null,
    exportedAt: now(),
  });
  const base = slug(bundle.course.title);
  const dir = resolve(baseDir, `${base}.ferrata`);
  const singleFile = resolve(baseDir, `${base}.ferrata.json`);

  await rm(dir, { recursive: true, force: true });
  const files = packageFiles(pkg);
  await mkdir(resolve(dir, "modules"), { recursive: true });
  await mkdir(resolve(dir, "sources"), { recursive: true });
  // File names are controlled relative paths (modules/…, sources/…), safe to join.
  await Promise.all(
    Object.entries(files).map(([name, content]) =>
      writeFile(resolve(dir, name), content, "utf8"),
    ),
  );
  await writeFile(singleFile, JSON.stringify(pkg, null, 2), "utf8");

  db.insert(packages)
    .values({
      id: newId("pkg"),
      courseId: bundle.course.id,
      manifestJson: JSON.stringify(pkg.manifest),
      sourceHash: pkg.manifest.sourceHash,
      trusted: true,
    })
    .run();

  return { dir, file: singleFile, fileCount: Object.keys(files).length + 1 };
}
