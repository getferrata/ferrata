import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sourceChunks, sources } from "@/db/schema";
import { retrieve, type ChunkDoc, type RetrievedChunk } from "./retrieve";

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
    .map((c, i) => `[${i + 1}] fonte: ${c.sourceName}\n${c.text}`)
    .join("\n\n---\n\n");
}

/**
 * A bounded overview of the attached material for intake: the first chunk(s) of
 * each source, so the concept list reflects the real material, not the model's
 * guess. Capped so it never blows the intake context.
 */
export function sourceOverview(chunks: ChunkDoc[], maxChars = 3500): string {
  const bySource = new Map<string, ChunkDoc[]>();
  for (const c of chunks) {
    const list = bySource.get(c.sourceName) ?? [];
    if (list.length < 2) list.push(c);
    bySource.set(c.sourceName, list);
  }
  let out = "";
  for (const [name, cs] of bySource) {
    const block = `### ${name}\n${cs.map((c) => c.text).join("\n")}\n\n`;
    if (out.length + block.length > maxChars) {
      out += block.slice(0, Math.max(0, maxChars - out.length));
      break;
    }
    out += block;
  }
  return out.trim();
}

export { retrieve, type ChunkDoc, type RetrievedChunk } from "./retrieve";
