import { db } from "@/db";
import { restorations, sourceChunks, sources } from "@/db/schema";
import { newId } from "@/lib/util/id";
import { sealSecret } from "@/lib/crypto/secrets";
import { chunkSource, chunkText } from "./chunk";
import { extractText } from "./extract";
import { extractDocxFigures, fillSlots } from "./docx-figures";
import { insertFigures, selectFigures, slotTokens, type KeptFigure } from "./figures";
import { fetchUrlText } from "./url";
import { scanSensitivity, type ContextiaMode } from "./dlp";
import { hashSourceText } from "./watch";
import { getLogger } from "@/lib/log";

const log = getLogger("ingest");

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function isDocx(name: string, mime: string | null): boolean {
  return /\.docx$/i.test(name) || mime === DOCX_MIME;
}

export type SourceInput =
  | { kind: "file"; name: string; mime: string | null; buf: Buffer }
  | { kind: "text"; name: string; text: string }
  | { kind: "url"; url: string };

export interface IngestResult {
  sourceId: string;
  name: string;
  ok: boolean;
  chunks: number;
  error?: string;
}

/**
 * Ingest one source into a course: extract text, pass it through the DLP gate
 * (Contextia seam), chunk it, and store the source + chunks. Ground-truth for
 * later grounded generation and citation.
 */
export async function ingestSource(
  courseId: string,
  input: SourceInput,
  contextiaMode?: ContextiaMode,
): Promise<IngestResult> {
  const sourceId = newId("src");
  const name = input.kind === "url" ? input.url : input.name;

  let text = "";
  let ok = true;
  let error: string | undefined;
  let errorKind: string | null = null;
  let bytes = 0;
  let mime: string | null = null;
  let kept: KeptFigure[] = [];

  if (input.kind === "text") {
    text = input.text;
    bytes = Buffer.byteLength(input.text, "utf8");
  } else if (input.kind === "url") {
    const res = await fetchUrlText(input.url);
    text = res.text ?? "";
    ok = res.ok;
    error = res.error;
    errorKind = res.errorKind ?? null;
    bytes = Buffer.byteLength(text, "utf8");
  } else {
    mime = input.mime;
    bytes = input.buf.length;
    if (isDocx(input.name, input.mime)) {
      // Second pass over the same file, taken only for the format that can
      // carry pictures. Everything about them is decided here, outside the
      // transaction below, because measuring an image means decoding it and
      // this database's transactions are synchronous.
      try {
        const doc = await extractDocxFigures(input.buf);
        kept = await selectFigures(courseId, sourceId, doc.figures);
        text = fillSlots(doc.text, slotTokens(kept, doc.figures.length));
        ok = true;
      } catch (err) {
        // A document whose pictures cannot be read is still a document. Fall
        // back to the plain text path rather than failing the whole source.
        log.warn(
          `figures could not be read from ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
        kept = [];
      }
    }
    if (!text) {
      const res = await extractText(input.name, input.mime, input.buf);
      text = res.text;
      ok = res.ok;
      error = res.error;
    }
  }

  // DLP gate (Contextia): redact/classify before anything is stored or grounded.
  const scan = ok
    ? await scanSensitivity(text, name, contextiaMode)
    : { text, verdict: null, restorations: [], blocked: false };
  const safeText = scan.text.trim();
  // "block" mode: a source with critical secrets is refused, not grounded on.
  const usable = ok && !scan.blocked && safeText.length > 0;

  db.transaction((tx) => {
    tx.insert(sources)
      .values({
        id: sourceId,
        courseId,
        kind: input.kind,
        name,
        mime,
        bytes,
        textLen: safeText.length,
        status: usable ? "ok" : "failed",
        error: scan.blocked
          ? "Blocked by Contextia: contains critical secrets. Clean it and re-upload."
          : ok
            ? safeText.length === 0
              ? "no text extracted"
              : null
            : error,
        errorKind: usable ? null : errorKind,
        sensitivityJson: scan.verdict ? JSON.stringify(scan.verdict) : null,
        // Of the text as fetched, not as redacted: this is the reading a later
        // check compares against to decide whether the source itself moved.
        contentHash: usable ? hashSourceText(text) : null,
      })
      .run();

    // Only for a source that is actually part of the course. A blocked or
    // unreadable document leaves no pictures behind either, and a pending
    // figure from a source nobody can see is a decision asked for nothing.
    if (usable && kept.length > 0) insertFigures(tx, courseId, sourceId, kept);

    if (usable) {
      for (const c of chunkSource(safeText, name)) {
        tx.insert(sourceChunks)
          .values({
            id: newId("chunk"),
            sourceId,
            courseId,
            ord: c.ord,
            text: c.text,
          })
          .run();
      }
    }

    // Restore map for reversible (operational) redactions, put back at render.
    // The value is a real internal IP or hostname, so it is sealed at rest like
    // an API key: a leaked DB copy carries the tokens, not the topology.
    for (const r of usable ? scan.restorations : []) {
      tx.insert(restorations)
        .values({
          id: newId("cxt"),
          courseId,
          token: r.token,
          value: sealSecret(r.value),
          label: r.label,
          type: r.type,
        })
        .run();
    }
  });

  const nChunks = ok && safeText.length > 0 ? chunkSource(safeText, name).length : 0;
  return { sourceId, name, ok: ok && safeText.length > 0, chunks: nChunks, error };
}
