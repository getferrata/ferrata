import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sourceChunks, sources } from "@/db/schema";
import {
  buildIndex,
  retrieveWith,
  type ChunkDoc,
  type RetrievedChunk,
} from "./retrieve";

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
 * How much material the planning stages get to read.
 *
 * 3500 characters is roughly 900 tokens, and it was chosen when the only
 * question was whether a small local model would cope. It is the wrong default
 * for the hosted models most installs use: the whole intake call costs a
 * fraction of a cent, input is billed at a fifth of output, and this is the one
 * stage whose mistakes are paid for fourteen times over, once per module it
 * plans. A course built from a thin read of its own material is the definition
 * of the thing this product exists not to produce.
 *
 * Lite mode keeps the old figure. That flag already means "a small or
 * rate-limited model", which is exactly the install for which a long prompt is
 * a problem rather than a rounding error.
 */
export function overviewBudget(): number {
  const override = Number(process.env.FERRATA_OVERVIEW_CHARS);
  if (Number.isFinite(override) && override >= 500) return Math.floor(override);
  return process.env.FERRATA_LITE === "1" ? 3_500 : 14_000;
}

export interface OverviewOptions {
  maxChars?: number;
  /**
   * What the course is about, in the author's words.
   *
   * Without it, each source is represented by whichever chunk happened to be
   * ingested first, which for a code file is the imports and for a document is
   * the title page. With it, each source is represented by its passage most
   * relevant to the brief, and sources are shown in that order, so a budget
   * that cannot cover 131 files covers the 20 that have something to say about
   * the subject rather than the 20 that were read first.
   */
  focus?: string;
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
export function sourceOverview(
  chunks: ChunkDoc[],
  opts: OverviewOptions | number = {},
): string {
  const { maxChars = overviewBudget(), focus } =
    typeof opts === "number" ? { maxChars: opts, focus: undefined } : opts;

  // The inventory keeps ingestion order, which for a repository is path order
  // and reads as a map of the thing. Only the excerpts are reordered, because
  // only they are competing for a budget.
  const names = [...new Set(chunks.map((c) => c.sourceName))];
  if (names.length === 0) return "";
  const excerpts = pickExcerpts(chunks, focus);

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
  // The divisor is capped so a corpus of hundreds does not grind each excerpt
  // down to a fragment that reads as noise; past that point the budget runs out
  // and the sources shown are the ones the brief actually asked about.
  const budget = Math.max(0, maxChars - listing.length);
  const per = Math.max(
    MIN_EXCERPT,
    Math.floor(budget / Math.min(excerpts.size, 30)),
  );

  let out = "";
  for (const [name, text] of excerpts) {
    const block = `### ${name}\n${text.slice(0, per)}\n\n`;
    if (out.length + block.length > budget) break;
    out += block;
  }
  return (listing + out).trim();
}

/** Below this an excerpt stops saying what a source is about. */
const MIN_EXCERPT = 200;

/**
 * The full text of specific sources, bounded, for a pass that reads NEW
 * material in its own right rather than retrieving snippets of everything.
 * Bounded per call, not per source, so one huge file cannot starve the rest.
 */
/**
 * One excerpt per source, keyed by source name, in the order they should be
 * shown.
 *
 * Without a focus this is the first chunk of each source, in ingestion order:
 * the behaviour this had before, and the only thing available when nobody has
 * said what the course is about. With one, the index is queried once and each
 * source is represented by its own best-scoring chunk, sources ordered by that
 * score. A source no chunk of which mentions anything in the brief keeps its
 * first chunk and goes to the back, because "this file exists and is about
 * something else" is still worth a line of the inventory.
 */
function pickExcerpts(
  chunks: ChunkDoc[],
  focus: string | undefined,
): Map<string, string> {
  const first = new Map<string, string>();
  for (const c of chunks) {
    if (!first.has(c.sourceName)) first.set(c.sourceName, c.text);
  }
  if (!focus || first.size === 0) return first;

  // One pass over the corpus, scoring every chunk against the brief. A course
  // planned from 131 files does this once, which is a few milliseconds of
  // arithmetic against a stage that costs money and time.
  const index = buildIndex(chunks);
  const ranked = retrieveWith(index, focus, chunks.length);
  const best = new Map<string, { text: string; score: number }>();
  for (const r of ranked) {
    const held = best.get(r.sourceName);
    if (!held || r.score > held.score) {
      best.set(r.sourceName, { text: r.text, score: r.score });
    }
  }

  const out = new Map<string, string>();
  for (const [name, { text }] of [...best.entries()].sort(
    (a, b) => b[1].score - a[1].score,
  )) {
    out.set(name, text);
  }
  // Everything the query did not touch, in the order it was ingested.
  for (const [name, text] of first) {
    if (!out.has(name)) out.set(name, text);
  }
  return out;
}

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
