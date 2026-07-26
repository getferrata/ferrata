/**
 * Split extracted source text into retrieval chunks. Deterministic and pure so
 * it can be unit-tested. Packs paragraphs greedily up to a size budget with a
 * small overlap so a concept that straddles two paragraphs still retrieves both.
 */

export interface Chunk {
  ord: number;
  text: string;
}

const MAX_CHARS = 1200; // ~300 tokens
const OVERLAP_CHARS = 150;

export function chunkText(raw: string, maxChars = MAX_CHARS): Chunk[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: Chunk[] = [];
  let buf = "";

  const flush = () => {
    const text = buf.trim();
    if (text) chunks.push({ ord: chunks.length, text });
  };

  for (const para of paragraphs) {
    // A single oversized paragraph is hard-split by sentence/length.
    if (para.length > maxChars) {
      if (buf) {
        flush();
        buf = "";
      }
      for (const piece of hardSplit(para, maxChars)) {
        chunks.push({ ord: chunks.length, text: piece });
      }
      continue;
    }
    if (buf.length + para.length + 2 > maxChars) {
      flush();
      // carry a small overlap from the tail of the previous buffer
      buf = buf.slice(-OVERLAP_CHARS);
    }
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  flush();

  return chunks.map((c, i) => ({ ord: i, text: c.text }));
}

function hardSplit(text: string, maxChars: number): string[] {
  const out: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let buf = "";
  for (const s of sentences) {
    if (s.length > maxChars) {
      if (buf) {
        out.push(buf.trim());
        buf = "";
      }
      for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars));
      continue;
    }
    if (buf.length + s.length + 1 > maxChars) {
      out.push(buf.trim());
      buf = "";
    }
    buf = buf ? `${buf} ${s}` : s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
