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
  // A cap below one would make the splitting loops advance by zero characters
  // and never finish. Nothing in the app passes such a value; this is here so
  // that staying true does not depend on nothing ever doing so.
  const cap = Math.max(1, Math.floor(maxChars));
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
    if (para.length > cap) {
      if (buf) {
        flush();
        buf = "";
      }
      for (const piece of hardSplit(para, cap)) {
        chunks.push({ ord: chunks.length, text: piece });
      }
      continue;
    }
    if (buf && buf.length + para.length + 2 > cap) {
      flush();
      // Carry a small overlap from the tail of the previous buffer, so a
      // concept that straddles two paragraphs still retrieves both. Dropped
      // when it will not fit beside the incoming paragraph: the overlap is an
      // aid to retrieval, and keeping it regardless is what used to push a
      // chunk past the cap it was given. That the cap was breakable at all was
      // invisible because OVERLAP_CHARS is a constant while the cap is an
      // argument, so it only showed up when the two were close together.
      const overlap = buf.slice(-OVERLAP_CHARS);
      buf = overlap.length + para.length + 2 <= cap ? overlap : "";
    }
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  flush();

  return chunks.map((c, i) => ({ ord: i, text: c.text }));
}

function hardSplit(text: string, cap: number): string[] {
  const out: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let buf = "";
  for (const s of sentences) {
    if (s.length > cap) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      out.push(...breakLongRun(s, cap));
      continue;
    }
    // Guarded on buf being non-empty: without it a sentence exactly `cap` long
    // arriving on an empty buffer pushed the empty string, and an empty chunk
    // is a row that grounds nothing and takes a slot in retrieval.
    if (buf && buf.length + s.length + 1 > cap) {
      out.push(buf.trim());
      buf = "";
    }
    buf = buf ? `${buf} ${s}` : s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Cut a run longer than the cap into pieces, preferring a space.
 *
 * It used to cut every `cap` characters flat, which splits whatever word
 * happens to sit on the boundary into two halves in two different chunks.
 * Neither half then matches a search for the whole term, so the passage the
 * word identifies becomes unfindable by the one query most likely to be asked
 * for it. A token genuinely longer than the cap still has to be cut; there is
 * nowhere else to put it.
 */
function breakLongRun(run: string, cap: number): string[] {
  const out: string[] = [];
  let rest = run.trim();
  while (rest.length > cap) {
    const at = rest.lastIndexOf(" ", cap);
    const cut = at > 0 ? at : cap;
    const piece = rest.slice(0, cut).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Chunking for code, which the prose splitter above gets wrong in the one way
 * that matters.
 *
 * That splitter packs paragraphs to 1200 characters and hard-splits anything
 * longer by sentence, then by length. On a source file a "paragraph" is
 * whatever sits between two blank lines, so a function longer than about thirty
 * lines is cut in the middle, sometimes inside a statement. Retrieval then
 * hands the writing stage half a function with no signature and no closing
 * brace, and a module meant to explain that function explains a fragment.
 *
 * Here a chunk is built from whole top-level blocks instead. The heuristic is
 * deliberately language-agnostic and says so: a line with no indentation starts
 * a new block, everything indented under it belongs to it. That is true of
 * every language this ingests, because it is a statement about layout rather
 * than about syntax, and it needs no parser per language to stay true.
 */

const CODE_CHARS = 3000;
/** A single block bigger than this is split anyway; there is nowhere else to put it. */
const CODE_HARD_CHARS = 9000;

const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|c|h|hpp|cpp|cc|cs|kt|swift|scala|ex|exs|clj|erl|hs|lua|sh|bash|zsh|ps1|sql|yaml|yml|toml|ini|tf|dockerfile)$/i;

/** Files with no extension that are still code by convention. */
const CODE_NAMES = /^(dockerfile|makefile|rakefile|gemfile|justfile|procfile)$/i;

export function isCodeSource(name: string): boolean {
  const base = name.split(/[/\\]/).pop() ?? name;
  return CODE_EXT.test(base) || CODE_NAMES.test(base);
}

/** A line that opens a top-level construct: column zero, and not a closer. */
function opensBlock(line: string): boolean {
  if (line.length === 0 || /^\s/.test(line)) return false;
  // A closing brace, a chained `} else {`, an `end`, a stray bracket: these sit
  // at column zero and continue the block above rather than starting one.
  return !/^[)\]}]|^(end|fi|done|esac)\b/.test(line.trim());
}

/**
 * Group lines into top-level blocks, with a comment or decorator kept attached
 * to what it introduces. A docblock separated from its function is the one
 * piece of context a reader most needs and the one a splitter most easily drops.
 */
function codeBlocks(lines: string[]): string[] {
  const blocks: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length > 0 && buf.join("\n").trim()) blocks.push(buf.join("\n"));
    buf = [];
  };
  for (const line of lines) {
    if (opensBlock(line) && buf.length > 0 && !onlyLeadIn(buf)) flush();
    buf.push(line);
  }
  flush();
  return blocks;
}

/** True while a buffer holds nothing but comments, decorators and blanks. */
function onlyLeadIn(buf: string[]): boolean {
  return buf.every((l) => {
    const t = l.trim();
    return (
      t === "" ||
      t.startsWith("//") ||
      t.startsWith("#") ||
      t.startsWith("/*") ||
      t.startsWith("*") ||
      t.startsWith("--") ||
      t.startsWith("@")
    );
  });
}

export function chunkCode(raw: string, maxChars = CODE_CHARS): Chunk[] {
  const cap = Math.max(1, Math.floor(maxChars));
  const normalized = raw.replace(/\r\n/g, "\n").trimEnd();
  if (!normalized.trim()) return [];

  const out: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) out.push(buf.replace(/\n+$/, ""));
    buf = "";
  };

  for (const block of codeBlocks(normalized.split("\n"))) {
    // Whole, even when it alone exceeds the budget: a function that does not
    // fit is exactly the function a reader needs to see entire. Only past the
    // hard ceiling does it get cut, and then by line so the pieces are still
    // readable code rather than a run of characters.
    if (block.length > CODE_HARD_CHARS) {
      flush();
      for (const piece of splitByLine(block, CODE_HARD_CHARS)) out.push(piece);
      continue;
    }
    if (buf && buf.length + block.length + 1 > cap) flush();
    buf = buf ? `${buf}\n${block}` : block;
  }
  flush();

  return out.map((text, ord) => ({ ord, text }));
}

function splitByLine(block: string, cap: number): string[] {
  const out: string[] = [];
  let buf = "";
  for (const line of block.split("\n")) {
    if (buf && buf.length + line.length + 1 > cap) {
      out.push(buf);
      buf = "";
    }
    buf = buf ? `${buf}\n${line}` : line;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/**
 * Chunk by what the source is. The name is the only signal available at
 * ingestion, and it is enough: nothing else distinguishes a wiki page from a
 * module of code once both are strings.
 */
export function chunkSource(raw: string, name: string): Chunk[] {
  return isCodeSource(name) ? chunkCode(raw) : chunkText(raw);
}
