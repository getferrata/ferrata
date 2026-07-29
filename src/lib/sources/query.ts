import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sourceChunks, sources } from "@/db/schema";
import { type ChunkDoc, type RetrievedChunk } from "./retrieve";

/** Load a course's source chunks with their source name, for retrieval. */
export function loadCourseChunks(courseId: string): ChunkDoc[] {
  const rows = db
    .select({
      sourceId: sourceChunks.sourceId,
      ord: sourceChunks.ord,
      text: sourceChunks.text,
      sourceName: sources.name,
    })
    .from(sourceChunks)
    .innerJoin(sources, eq(sources.id, sourceChunks.sourceId))
    .where(eq(sourceChunks.courseId, courseId))
    .all();
  return rows.map((r) => ({
    sourceId: r.sourceId,
    sourceName: r.sourceName,
    ord: r.ord,
    text: r.text,
  }));
}

export function hasSources(courseId: string): boolean {
  const row = db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.courseId, courseId))
    .limit(1)
    .get();
  return Boolean(row);
}

/** Retrieved chunks for a concept, formatted for a prompt with citations. */
export function formatGrounding(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  return chunks
    .map((c, i) => `[${i + 1}] source: ${c.sourceName}\n${c.text}`)
    .join("\n\n---\n\n");
}

/**
 * A bounded overview of the attached material, for the stages that must know
 * what is there before deciding anything: intake picks the concept list from it,
 * and the authoring interview decides what is worth asking.
 *
 * Two parts, because they answer different questions.
 *
 * The inventory first: every source name. For a repository the paths ARE the
 * architecture, they cost a few tokens each, and leaving them out was the flaw
 * this replaced. The old shape spent its whole budget on the first sources it
 * met, so a course built on 131 files was planned from the two that happened to
 * be ingested first, and the stages downstream concluded the material did not
 * cover the subject when it did.
 *
 * Then a spread of excerpts, one per source, walking the whole list rather than
 * exhausting it from the top. A thin slice of everything beats all of nothing.
 */
export function sourceOverview(chunks: ChunkDoc[], maxChars = 3500): string {
  const firstBySource = new Map<string, string>();
  for (const c of chunks) {
    if (!firstBySource.has(c.sourceName)) firstBySource.set(c.sourceName, c.text);
  }
  const names = [...firstBySource.keys()];
  if (names.length === 0) return "";

  // The inventory gets at most this share of the budget: a large repository must
  // not crowd the excerpts out, and a couple of files must not reserve room they
  // do not need.
  const header = `## What is attached (${names.length} source${names.length === 1 ? "" : "s"})\n`;
  const nameBudget = Math.floor(maxChars * 0.5);
  const flat = names.map((n) => `- ${n}\n`).join("");

  // Every path when they fit. When they do not, a rollup by folder instead of a
  // truncated list: for a repository the folder names ARE the architecture, and
  // "packages/engine/src/detectors/ (35 files)" says more per character than
  // thirty-five paths, of which a cut list would have shown the first eleven and
  // silently implied the rest do not exist.
  let listing = header;
  if (header.length + flat.length <= nameBudget) {
    listing += flat;
  } else {
    const byDir = new Map<string, number>();
    for (const n of names) {
      const cut = n.lastIndexOf("/");
      const dir = cut === -1 ? "(root)" : n.slice(0, cut + 1);
      byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
    }
    const dirs = [...byDir.entries()].sort((a, b) => b[1] - a[1]);
    let shown = 0;
    for (const [dir, n] of dirs) {
      const line = `- ${dir} (${n} file${n === 1 ? "" : "s"})\n`;
      if (listing.length + line.length > nameBudget) break;
      listing += line;
      shown++;
    }
    if (shown < dirs.length) {
      listing += `- and ${dirs.length - shown} more folders\n`;
    }
  }
  listing += "\n## Excerpts\n\n";

  // What is left goes to excerpts, split so every source gets a turn before any
  // gets a second helping: a thin slice of everything beats all of nothing.
  const budget = Math.max(0, maxChars - listing.length);
  const per = Math.max(120, Math.floor(budget / Math.min(names.length, 20)));

  let out = "";
  for (const name of names) {
    const text = (firstBySource.get(name) ?? "").slice(0, per);
    const block = `### ${name}\n${text}\n\n`;
    if (out.length + block.length > budget) break;
    out += block;
  }
  return (listing + out).trim();
}

/**
 * The full text of specific sources, bounded, for a pass that reads NEW
 * material in its own right rather than retrieving snippets of everything.
 * Bounded per call, not per source, so one huge file cannot starve the rest.
 */
export function sourceTexts(sourceIds: string[], maxChars = 24_000): string {
  if (sourceIds.length === 0) return "";
  const rows = db
    .select({
      sourceId: sourceChunks.sourceId,
      ord: sourceChunks.ord,
      text: sourceChunks.text,
      sourceName: sources.name,
    })
    .from(sourceChunks)
    .innerJoin(sources, eq(sources.id, sourceChunks.sourceId))
    .all()
    .filter((r) => sourceIds.includes(r.sourceId))
    .sort((a, b) =>
      a.sourceId === b.sourceId
        ? a.ord - b.ord
        : a.sourceId.localeCompare(b.sourceId),
    );
  let out = "";
  let lastSource = "";
  for (const r of rows) {
    const header = r.sourceId === lastSource ? "" : `### ${r.sourceName}\n`;
    lastSource = r.sourceId;
    const block = `${header}${r.text}\n\n`;
    if (out.length + block.length > maxChars) {
      out += block.slice(0, Math.max(0, maxChars - out.length));
      break;
    }
    out += block;
  }
  return out.trim();
}

export {
  buildIndex,
  retrieve,
  retrieveWith,
  type Bm25Index,
  type ChunkDoc,
  type RetrievedChunk,
} from "./retrieve";
