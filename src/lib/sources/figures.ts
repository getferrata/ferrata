import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  concepts,
  figures,
  modules,
  sourceChunks,
  sources,
  type Figure,
  type FigureStatus,
} from "@/db/schema";
import { newId, now } from "@/lib/util/id";
import { getLogger } from "@/lib/log";

const log = getLogger("figures");

/**
 * Pictures taken out of a source document.
 *
 * Images are the one thing that walks past the DLP gate: it scans strings, and
 * a screenshot of a terminal holding an API key is not a string. So a figure
 * never becomes part of a course by arriving. It arrives pending, the author is
 * shown it, and it is in the course only once they say so. A person looking at
 * the pixels catches what text scanning cannot: the key, and also the whiteboard
 * with a customer's name on it.
 *
 * Everything below the extraction is deliberately boring: a token in the text
 * where the picture was, bytes in the same database as everything else, and one
 * decision per figure recorded with who made it.
 */

/** The token left in the text, twin of the Contextia placeholder. */
export const FIGURE_TOKEN = /⟨fig:([0-9a-f]{12})⟩/g;

export function figureToken(sha256: string): string {
  return `⟨fig:${sha256.slice(0, 12)}⟩`;
}

/**
 * A picture below this on either side is furniture: a bullet, a logo, a spacer,
 * a signature scan. Nobody learns from it and every one of them is another
 * decision asked of the author for nothing.
 */
export const MIN_EDGE_PX = 120;

/** And one this large is a scan of a whole page, not a figure inside a page. */
export const MAX_BYTES = 8 * 1024 * 1024;

/** Per source, so one pathological document cannot fill the database. */
export const MAX_PER_SOURCE = 40;

export interface ExtractedFigure {
  buf: Buffer;
  mime: string;
  altText: string | null;
}

export interface StoredFigure {
  id: string;
  sha256: string;
  token: string;
}

/** sha256 of the bytes: the dedup key and what the token points at. */
export function figureHash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Reject anything that is not a picture we can measure and serve.
 *
 * Format is decided by the bytes rather than by the mime the document claims,
 * because the document is untrusted input and a mime is a string somebody
 * wrote. sharp reads the header; if it will not, this is not an image.
 */
const ALLOWED = new Set(["png", "jpeg", "webp", "gif", "avif", "tiff"]);

export interface Measured {
  width: number;
  height: number;
  mime: string;
}

export async function measure(buf: Buffer): Promise<Measured | null> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf).metadata();
    const format = meta.format ?? "";
    if (!ALLOWED.has(format)) return null;
    if (!meta.width || !meta.height) return null;
    return {
      width: meta.width,
      height: meta.height,
      // Named from what sharp read, not from what the document said it was.
      mime: format === "jpeg" ? "image/jpeg" : `image/${format}`,
    };
  } catch {
    return null;
  }
}

/** Worth asking the author about: big enough to teach from, small enough to store. */
export function worthKeeping(m: Measured, bytes: number): boolean {
  if (bytes > MAX_BYTES) return false;
  return m.width >= MIN_EDGE_PX && m.height >= MIN_EDGE_PX;
}

/** A figure that survived selection, ready to be written. */
export interface KeptFigure extends StoredFigure {
  buf: Buffer;
  mime: string;
  width: number;
  height: number;
  altText: string | null;
  /** Index in the source's original list, so the text markers can be filled. */
  slot: number;
}

/**
 * Decide what is worth keeping, without writing anything.
 *
 * Split from the insert because measuring means decoding, decoding is async,
 * and this database's transactions are synchronous: an await inside one holds
 * the write lock open across the event loop. So all the deciding happens here
 * and the writing is a plain loop the caller runs inside its own transaction,
 * alongside the source row the figures point at.
 *
 * Duplicates go by hash across the whole course rather than the one source: the
 * same header logo in twelve documents is one picture, and asking about it
 * twelve times is how an approval step becomes a thing people click through
 * without looking.
 */
export async function selectFigures(
  courseId: string,
  sourceId: string,
  found: ExtractedFigure[],
): Promise<KeptFigure[]> {
  const seen = new Set(
    db
      .select({ sha256: figures.sha256 })
      .from(figures)
      .where(eq(figures.courseId, courseId))
      .all()
      .map((f) => f.sha256),
  );
  const out: KeptFigure[] = [];
  for (const [slot, f] of found.entries()) {
    if (out.length >= MAX_PER_SOURCE) {
      log.warn(
        `source ${sourceId} carried more than ${MAX_PER_SOURCE} figures; the rest were skipped`,
      );
      break;
    }
    const sha256 = figureHash(f.buf);
    if (seen.has(sha256)) continue;
    const m = await measure(f.buf);
    if (!m || !worthKeeping(m, f.buf.length)) continue;
    seen.add(sha256);
    out.push({
      id: newId("fig"),
      sha256,
      token: figureToken(sha256),
      buf: f.buf,
      mime: m.mime,
      width: m.width,
      height: m.height,
      altText: f.altText,
      slot,
    });
  }
  return out;
}

/** Write the selected figures. Synchronous, to be run inside the caller's transaction. */
export function insertFigures(
  tx: { insert: typeof db.insert },
  courseId: string,
  sourceId: string,
  kept: KeptFigure[],
): void {
  kept.forEach((f, ord) => {
    tx.insert(figures)
      .values({
        id: f.id,
        courseId,
        sourceId,
        sha256: f.sha256,
        mime: f.mime,
        bytes: f.buf.length,
        width: f.width,
        height: f.height,
        altText: f.altText,
        ord,
        status: "pending",
        data: f.buf,
      })
      .run();
  });
}

/**
 * The token for each slot in the source's original picture list, or null where
 * the picture was dropped as furniture or as a duplicate.
 */
export function slotTokens(kept: KeptFigure[], total: number): (string | null)[] {
  const bySlot = new Map(kept.map((f) => [f.slot, f.token]));
  return Array.from({ length: total }, (_, i) => bySlot.get(i) ?? null);
}

/** Figures of a course, newest decision last, without dragging the bytes along. */
export function listFigures(
  courseId: string,
  status?: FigureStatus,
): Omit<Figure, "data">[] {
  const where = status
    ? and(eq(figures.courseId, courseId), eq(figures.status, status))
    : eq(figures.courseId, courseId);
  return db
    .select({
      id: figures.id,
      courseId: figures.courseId,
      sourceId: figures.sourceId,
      sha256: figures.sha256,
      mime: figures.mime,
      bytes: figures.bytes,
      width: figures.width,
      height: figures.height,
      altText: figures.altText,
      ord: figures.ord,
      status: figures.status,
      decidedAt: figures.decidedAt,
      decidedBy: figures.decidedBy,
      createdAt: figures.createdAt,
    })
    .from(figures)
    .where(where)
    .orderBy(asc(figures.ord))
    .all();
}

/**
 * The approved figures of a course, with their bytes, for an export.
 *
 * Only the approved ones, and that is decided here rather than at each call
 * site: "which pictures may leave this install" is one question with one
 * answer, and a second caller getting it wrong would send out something nobody
 * looked at.
 */
export function exportableFigures(courseId: string): {
  sha256: string;
  mime: string;
  width: number;
  height: number;
  altText: string | null;
  data: Buffer;
}[] {
  return db
    .select({
      sha256: figures.sha256,
      mime: figures.mime,
      width: figures.width,
      height: figures.height,
      altText: figures.altText,
      data: figures.data,
    })
    .from(figures)
    .where(and(eq(figures.courseId, courseId), eq(figures.status, "approved")))
    .orderBy(asc(figures.ord))
    .all();
}

/** The bytes, for the route that serves them. Null when there is no such figure. */
export function figureBytes(
  courseId: string,
  id: string,
): { data: Buffer; mime: string; status: FigureStatus } | null {
  const row = db
    .select({ data: figures.data, mime: figures.mime, status: figures.status })
    .from(figures)
    .where(and(eq(figures.id, id), eq(figures.courseId, courseId)))
    .get();
  return row ? { data: row.data, mime: row.mime, status: row.status } : null;
}

export function decideFigure(
  courseId: string,
  id: string,
  status: Exclude<FigureStatus, "pending">,
  userId: string,
): boolean {
  const res = db
    .update(figures)
    .set({ status, decidedAt: now(), decidedBy: userId })
    .where(and(eq(figures.id, id), eq(figures.courseId, courseId)))
    .run();
  return res.changes > 0;
}

/**
 * Turn the tokens in a body into markdown images, for the approved ones only.
 *
 * A token whose figure is pending, rejected or gone is removed rather than left
 * on the page: the reader is not owed the knowledge that a picture was
 * considered and not shown, and a broken image is worse than no image. Done
 * here, at render time, rather than by rewriting the stored body, so changing
 * a decision changes what readers see without touching what the model wrote.
 */
export function renderFigureTokens(courseId: string, bodyMd: string): string {
  if (!bodyMd.includes("⟨fig:")) return bodyMd;
  const approved = new Map(
    listFigures(courseId, "approved").map((f) => [f.sha256.slice(0, 12), f]),
  );
  return bodyMd.replace(FIGURE_TOKEN, (_, short: string) => {
    const f = approved.get(short);
    if (!f) return "";
    const alt = (f.altText ?? "").replace(/[[\]()]/g, " ").trim();
    return `![${alt}](/api/courses/${courseId}/figures/${f.id})`;
  });
}

export interface FigureDescription {
  id: string;
  /** What a module body would contain to show it. */
  token: string;
  status: FigureStatus;
  /** The document it came out of, which is usually how an author knows it. */
  sourceName: string;
  altText: string | null;
  /** The prose it sat between, which is the only clue to what it depicts. */
  around: string;
  /** Concept titles whose module currently shows it, if any. */
  usedBy: string[];
}

/** How much text either side of the token is enough to recognise a picture. */
const AROUND_CHARS = 220;

/**
 * Describe a course's pictures well enough for a model to talk about one.
 *
 * Nothing here can see an image, so a picture has to be identified by what
 * surrounds it: the document it came from, its alt text when the document had
 * any, the sentences it sat between, and whether a module already shows it.
 * That is enough to say "the topology diagram from the new handbook replaces
 * the one in module three", which is the sentence the whole update path needs
 * and could not previously form.
 */
export function describeFigures(courseId: string): FigureDescription[] {
  const rows = listFigures(courseId);
  if (rows.length === 0) return [];

  const names = new Map(
    db
      .select({ id: sources.id, name: sources.name })
      .from(sources)
      .where(eq(sources.courseId, courseId))
      .all()
      .map((s) => [s.id, s.name]),
  );

  const chunks = db
    .select({ text: sourceChunks.text })
    .from(sourceChunks)
    .where(eq(sourceChunks.courseId, courseId))
    .all()
    .map((c) => c.text)
    .filter((t) => t.includes("⟨fig:"));

  const bodies = db
    .select({ title: concepts.title, bodyMd: modules.bodyMd })
    .from(modules)
    .innerJoin(concepts, eq(concepts.id, modules.conceptId))
    .where(eq(concepts.courseId, courseId))
    .all();

  return rows.map((f) => {
    const token = figureToken(f.sha256);
    const chunk = chunks.find((t) => t.includes(token));
    let around = "";
    if (chunk) {
      const at = chunk.indexOf(token);
      around = chunk
        .slice(Math.max(0, at - AROUND_CHARS), at + token.length + AROUND_CHARS)
        .replace(token, " [QUI] ")
        .replace(/\s+/g, " ")
        .trim();
    }
    return {
      id: f.id,
      token,
      status: f.status,
      sourceName: names.get(f.sourceId) ?? "(unknown document)",
      altText: f.altText,
      around,
      usedBy: bodies
        .filter((b) => b.bodyMd?.includes(token))
        .map((b) => b.title),
    };
  });
}
