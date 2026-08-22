import type { ExtractedFigure } from "./figures";

/**
 * Pull the pictures out of a .docx, with a marker left where each one sat.
 *
 * Separate from extract.ts, which stays a plain "give me the text" and is used
 * by everything. This is the path taken only when figures are wanted: it costs
 * a second pass over the document, and a document with no pictures in it should
 * not pay for one.
 *
 * The position matters. A diagram three paragraphs above the paragraph
 * explaining it is a different document from one with all the diagrams at the
 * end, and the module writer only sees the text: a marker in the right place is
 * the only way the picture ends up near what it illustrates.
 */

export interface DocxFigures {
  /** The document's text, with a marker where each kept picture was. */
  text: string;
  figures: ExtractedFigure[];
}

/** Placeholder used only between the two passes here, never stored. */
const SLOT = (i: number): string => `[[FIG${i}]]`;

/**
 * A picture bigger than this is not read into memory at all. The cap is on the
 * raw bytes because that is what is known before decoding, and decoding is the
 * expensive part: a document that claims a 400 MB image should cost nothing to
 * refuse.
 */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** And a bound on how many, so one document cannot hold the process hostage. */
const MAX_IMAGES = 60;

/**
 * The alt text a document gave a picture, when it gave one.
 *
 * Read defensively because mammoth carries altText on the image at runtime and
 * its type definitions do not mention it. Worth having: it is the only words
 * anybody wrote about that picture, it is what a screen reader will say, and
 * it is a hint to the module writer about what the picture is for.
 */
function altTextOf(image: unknown): string | null {
  const alt = (image as { altText?: unknown }).altText;
  return typeof alt === "string" && alt.trim() ? alt.trim() : null;
}

export async function extractDocxFigures(buf: Buffer): Promise<DocxFigures> {
  const mammoth = await import("mammoth");
  const found: ExtractedFigure[] = [];

  const result = await mammoth.convertToHtml(
    { buffer: buf },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        // An empty src rather than no attributes: the type wants a string, and
        // the stripper below keeps only the ones carrying a slot anyway.
        if (found.length >= MAX_IMAGES) return { src: "" };
        const bytes = await image.read();
        const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        if (data.length > MAX_IMAGE_BYTES) return { src: "" };
        const i = found.length;
        found.push({
          buf: data,
          // What the document claims, kept only as a hint: the format is
          // decided later by reading the bytes.
          mime: image.contentType ?? "application/octet-stream",
          altText: altTextOf(image),
        });
        // The slot rides through as the src of an img tag and is swapped for
        // the real token once the figures have been stored and the ones that
        // are furniture have been dropped.
        return { src: SLOT(i) };
      }),
    },
  );

  return { text: htmlToText(result.value ?? ""), figures: found };
}

/**
 * The generated HTML back to text, keeping the slots.
 *
 * mammoth's output is a small, known set of tags, so this is a stripper rather
 * than a parser: block tags become newlines, images become their slot, the rest
 * goes. Anything unexpected in the input is dropped rather than kept, which is
 * the right way round for text that came out of somebody's upload.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, (_, src: string) =>
      src.startsWith("[[FIG") ? `\n\n${src}\n\n` : "",
    )
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/(p|h[1-6]|tr|div|table)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Last, or it would turn the entities above back into markup.
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Swap the slots for the tokens of the figures that were actually kept.
 *
 * A slot with no figure behind it, because the picture was furniture or a
 * duplicate, is removed. Leaving it would put a marker in the text pointing at
 * nothing, which the module writer would faithfully copy into a module.
 */
export function fillSlots(text: string, tokens: (string | null)[]): string {
  return text
    .replace(/\[\[FIG(\d+)\]\]/g, (_, n: string) => tokens[Number(n)] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
