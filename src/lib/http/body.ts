/**
 * Size limits enforced by counting bytes off the stream, not by believing the
 * request.
 *
 * `Content-Length` is a claim the caller makes about itself: it is absent under
 * chunked transfer encoding, and when present it is not checked against what
 * actually arrives. A cap built on it therefore skips entirely for anyone who
 * omits the header, which is the one case that matters. Ferrata runs as a single
 * process that also serves every student, so one oversized upload buffered whole
 * is not a slow page, it is the whole install.
 */

/** Read a stream into a Buffer, or return null once it passes `max` bytes. */
export async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<Buffer | null> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * Read a multipart body with a hard ceiling and parse it.
 *
 * "Too large" and "not a form" are told apart on purpose: they deserve different
 * answers (413 against 400), and collapsing them would tell somebody whose
 * upload was refused for size that their request was malformed.
 */
export type CappedForm =
  | { ok: true; form: FormData }
  | { ok: false; reason: "too_large" | "malformed" };

export async function cappedFormData(
  req: Request,
  max: number,
): Promise<CappedForm> {
  const buf = await readCapped(req.body, max);
  if (buf === null) return { ok: false, reason: "too_large" };
  try {
    // Re-wrap the bytes we counted so the standard multipart parser does the
    // parsing, with the Content-Type (and its boundary) carried over.
    const body = new Uint8Array(buf);
    const form = await new Response(body, { headers: req.headers }).formData();
    return { ok: true, form };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}
