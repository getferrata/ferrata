import { db } from "@/db";
import { restorations, sourceChunks, sources } from "@/db/schema";
import { newId } from "@/lib/util/id";
import { sealSecret } from "@/lib/crypto/secrets";
import { chunkText } from "./chunk";
import { extractText } from "./extract";
import { fetchUrlText } from "./url";
import { scanSensitivity, type ContextiaMode } from "./dlp";

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
    const res = await extractText(input.name, input.mime, input.buf);
    text = res.text;
    ok = res.ok;
    error = res.error;
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
      })
      .run();

    if (usable) {
      for (const c of chunkText(safeText)) {
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

  const nChunks = ok && safeText.length > 0 ? chunkText(safeText).length : 0;
  return { sourceId, name, ok: ok && safeText.length > 0, chunks: nChunks, error };
}
