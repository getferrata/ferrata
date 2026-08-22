import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CourseBundle } from "@/lib/course/query";

/**
 * Export a course as an Obsidian-style Markdown vault: one note per module with
 * frontmatter, the prerequisite DAG expressed as [[wikilinks]] (so Obsidian's
 * graph view reconstructs it), plus an index note and the glossary. Tool-agnostic:
 * the same folder opens in Logseq and Foam (decision C).
 */

function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

/** Note basename Obsidian links resolve against (no extension). */
function noteName(index: number, title: string): string {
  return `${String(index).padStart(2, "0")} ${title.replace(/[\\/:*?"<>|#^[\]]/g, "")}`.trim();
}

export interface Vault {
  dirName: string;
  files: { name: string; content: string }[];
  /** Pictures the notes embed, written beside them so the vault stands alone. */
  assets: { name: string; data: Buffer }[];
}

/** An approved figure, with the bytes, as the caller reads them. */
export interface VaultFigure {
  sha256: string;
  mime: string;
  data: Buffer;
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/tiff": "tiff",
};

/**
 * Turn the figure tokens in a body into embeds, and name the files they point
 * at.
 *
 * Obsidian's own `![[file]]` rather than markdown's `![](path)`, because that is
 * what makes the picture show in the vault and travel with a note somebody
 * drags into another folder.
 *
 * A token whose figure is not here, because it was never approved or was left
 * out of the export, is removed. A vault carrying `⟨fig:...⟩` in the prose
 * would be showing the reader the plumbing.
 */
export function embedFigures(
  bodyMd: string,
  figures: VaultFigure[],
): { body: string; used: Set<string> } {
  const used = new Set<string>();
  if (!bodyMd.includes("⟨fig:")) return { body: bodyMd, used };
  const bySlug = new Map(figures.map((f) => [f.sha256.slice(0, 12), f]));
  const body = bodyMd.replace(/⟨fig:([0-9a-f]{12})⟩/g, (_, short: string) => {
    const f = bySlug.get(short);
    if (!f) return "";
    used.add(f.sha256);
    return `![[${assetName(f)}]]`;
  });
  return { body, used };
}

export function assetName(f: VaultFigure): string {
  return `assets/fig-${f.sha256.slice(0, 12)}.${EXT[f.mime] ?? "png"}`;
}

export function buildVault(
  bundle: CourseBundle,
  figures: VaultFigure[] = [],
): Vault {
  const { course, modules, edges, cuts } = bundle;
  const nameByConcept = new Map<string, string>();
  modules.forEach((m, i) => nameByConcept.set(m.concept.id, noteName(i, m.concept.title)));

  const link = (conceptId: string): string | null => {
    const n = nameByConcept.get(conceptId);
    return n ? `[[${n}]]` : null;
  };

  const files: { name: string; content: string }[] = [];
  const usedFigures = new Set<string>();

  // Index note.
  const indexLines = [
    "---",
    `title: "${course.title.replace(/"/g, "'")}"`,
    "type: percorso",
    `tags: [ferrata]`,
    "---",
    "",
    `# ${course.title}`,
    "",
    course.objective ?? "",
    "",
    course.concretenessRule ? `> **Regola.** ${course.concretenessRule}` : "",
    "",
    "## Moduli",
    ...modules.map((m) => {
      const l = link(m.concept.id);
      return l ? `- ${l}` : `- ${m.concept.title}`;
    }),
    "",
    course.scheduleMd ? "## Piano orario\n\n" + course.scheduleMd : "",
    "",
    cuts.length
      ? "## Cosa non studierai\n\n" +
        cuts.map((c) => `- ~~${c.title}~~: ${c.reason}`).join("\n")
      : "",
    "",
    course.glossaryMd ? "Vedi [[Glossario]]." : "",
  ];
  files.push({ name: "00 Percorso.md", content: indexLines.join("\n").replace(/\n{3,}/g, "\n\n") });

  // One note per module.
  modules.forEach((m, i) => {
    const prereqLinks = edges
      .filter((e) => e.to === m.concept.id)
      .map((e) => link(e.from))
      .filter((l): l is string => Boolean(l));
    const nextLinks = edges
      .filter((e) => e.from === m.concept.id)
      .map((e) => link(e.to))
      .filter((l): l is string => Boolean(l));

    const { body: embedded, used } = embedFigures(
      m.module?.bodyMd ?? m.concept.summary,
      figures,
    );
    for (const sha of used) usedFigures.add(sha);

    const parts = [
      "---",
      `title: "${m.concept.title.replace(/"/g, "'")}"`,
      `priority: ${m.concept.priority}`,
      `depth: ${m.concept.depthLevel}`,
      `estimated_minutes: ${m.concept.estimatedMinutes}`,
      m.module?.kind ? `kind: ${m.module.kind}` : "",
      "tags: [ferrata, modulo]",
      "---",
      "",
      `# ${m.concept.title}`,
      "",
      embedded,
      "",
    ];
    if (prereqLinks.length) {
      parts.push("## Propedeutici", ...prereqLinks.map((l) => `- ${l}`), "");
    }
    if (nextLinks.length) {
      parts.push("## Porta a", ...nextLinks.map((l) => `- ${l}`), "");
    }
    if (m.questions.length) {
      parts.push("## Test");
      m.questions.forEach((q, qi) => {
        parts.push(`${qi + 1}. ${q.prompt}`, `   - Risposta: ${q.expectedAnswer}`);
      });
      parts.push("");
    }
    files.push({
      name: `${noteName(i, m.concept.title)}.md`,
      content: parts.filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n"),
    });
  });

  if (course.glossaryMd) {
    files.push({
      name: "Glossario.md",
      content: `---\ntitle: Glossario\ntags: [ferrata, glossario]\n---\n\n${course.glossaryMd}`,
    });
  }

  return {
    dirName: slug(course.title) || "corso",
    files,
    // Only the pictures a note actually embeds. A vault carrying an image no
    // page shows is an image somebody exported by accident.
    assets: figures
      .filter((f) => usedFigures.has(f.sha256))
      .map((f) => ({ name: assetName(f), data: f.data })),
  };
}

/** Write the vault under the export dir and return the absolute path. */
export async function writeVault(
  bundle: CourseBundle,
  figures: VaultFigure[] = [],
  baseDir = process.env.FERRATA_EXPORT_DIR
    ? resolve(process.env.FERRATA_EXPORT_DIR)
    : resolve(process.cwd(), "exports"),
): Promise<{ path: string; fileCount: number }> {
  const vault = buildVault(bundle, figures);
  // Same guard as the .ferrata.json export: refuse to write if a real protected
  // value (a hand-edited module could reintroduce one) would leave in clear.
  // The vault carries ⟨cxt:⟩ tokens, never the values behind them.
  const leaked = bundle.restorations.filter(
    (r) => r.value.length > 3 && vault.files.some((f) => f.content.includes(r.value)),
  );
  if (leaked.length > 0) {
    throw new Error(
      `Export refused: the vault would carry ${leaked.length} protected value(s) in clear (${leaked
        .map((r) => r.label)
        .join(", ")}). Nothing was written.`,
    );
  }
  const dir = resolve(baseDir, vault.dirName);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  if (vault.assets.length > 0) {
    await mkdir(resolve(dir, "assets"), { recursive: true });
  }
  await Promise.all(
    [
      ...vault.files.map((f) => writeFile(resolve(dir, f.name), f.content, "utf8")),
      ...vault.assets.map((a) => writeFile(resolve(dir, a.name), a.data)),
    ],
  );
  return { path: dir, fileCount: vault.files.length + vault.assets.length };
}
