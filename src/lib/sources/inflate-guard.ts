import { inflateSync } from "node:zlib";

/**
 * Refuse a zip-based document that would inflate far beyond what it weighs,
 * before anything inflates it.
 *
 * The upload limit is on the bytes received, and a docx is a zip of XML that
 * compresses a thousandfold: measured, 0.14 MB took 23 s and 4 GB to read and
 * 0.34 MB took 82 s and 6.5 GB, on the single process that serves everyone. The
 * sizes are declared in the central directory at the end of the file, so they
 * can be read without inflating anything, and the library that reads the
 * archive afterwards refuses an entry whose real size differs from its declared
 * one, so a file cannot declare small and inflate large.
 */

/** All the XML parts together: ~10 MB of it is about 2,000 pages of text. */
export const MAX_XML_BYTES = 10 * 1024 * 1024;
/** Everything in the archive, images included. */
export const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;
const MAX_ENTRIES = 5_000;

export class ZipTooLargeError extends Error {
  constructor(reason: string) {
    super(`This document is too large to read (${reason}). Split it into smaller files.`);
    this.name = "ZipTooLargeError";
  }
}

/** Throws ZipTooLargeError; returns quietly for anything that is not a zip, so the parser reports that itself. */
export function assertReasonableZip(buf: Buffer): void {
  // The end-of-central-directory record sits in the last 64 KiB + 22 bytes.
  const from = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return;

  const entries = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || at === 0xffffffff) {
    throw new ZipTooLargeError("zip64 archive");
  }
  if (entries > MAX_ENTRIES) throw new ZipTooLargeError(`${entries} files inside`);

  let xml = 0;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) return;
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    if (size === 0xffffffff) throw new ZipTooLargeError("zip64 entry");
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen).toLowerCase();
    total += size;
    if (name.endsWith(".xml") || name.endsWith(".rels")) xml += size;
    if (xml > MAX_XML_BYTES) {
      throw new ZipTooLargeError(`${Math.round(xml / 1048576)} MB of text inside`);
    }
    if (total > MAX_UNPACKED_BYTES) {
      throw new ZipTooLargeError(`${Math.round(total / 1048576)} MB unpacked`);
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
}

/** Text and layout streams of a PDF, once inflated. Images are not counted: a scan legitimately inflates to tens of MB. */
export const MAX_PDF_CONTENT_BYTES = 64 * 1024 * 1024;

/**
 * Same idea for a PDF: its page content is Flate-compressed streams, which a
 * parser inflates in full. Measured, a 0.12 MB file took 7.8 s to read and the
 * time grows linearly with what the streams hold, so a 10 MB file is minutes of
 * the one process that serves everyone. A PDF has no table of inflated sizes
 * to read, so the streams are inflated here instead, with a ceiling, which costs
 * at most the ceiling.
 */
export function assertReasonablePdf(buf: Buffer): void {
  if (buf.length < 8 || buf.toString("latin1", 0, 5) !== "%PDF-") return;
  const text = buf.toString("latin1");
  let used = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf("stream", from);
    if (at === -1) return;
    from = at + 6;
    if (text.startsWith("end", at - 3)) continue; // "endstream"
    let start = at + 6;
    if (text[start] === "\r") start += 1;
    if (text[start] !== "\n") continue;
    start += 1;
    const dict = text.slice(Math.max(0, at - 2048), at);
    const open = dict.lastIndexOf("obj");
    const header = open === -1 ? dict : dict.slice(open);
    if (!header.includes("/FlateDecode") || header.includes("/Image")) continue;
    const end = text.indexOf("endstream", start);
    if (end === -1) continue;
    try {
      used += inflateSync(buf.subarray(start, end), {
        maxOutputLength: MAX_PDF_CONTENT_BYTES - used + 1,
      }).length;
    } catch (err) {
      if ((err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
        throw new ZipTooLargeError(`more than ${MAX_PDF_CONTENT_BYTES / 1048576} MB of page content`);
      }
      continue; // not a stream this can read; the parser will say so itself
    }
    if (used > MAX_PDF_CONTENT_BYTES) {
      throw new ZipTooLargeError(`more than ${MAX_PDF_CONTENT_BYTES / 1048576} MB of page content`);
    }
    from = end;
  }
}
