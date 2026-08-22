/**
 * The delimiter format used by every stage whose output is a long markdown
 * body: some short header lines, a lone `---BODY---` marker, then the raw
 * markdown.
 *
 * A long body carried inside a JSON string pays an escaping tax on every quote,
 * backslash and newline. That costs tokens twice over: once to emit the escapes,
 * and again when the inflated output runs past the token cap, because a repaired
 * truncated object still validates and the call is retried in full. Keeping the
 * body raw removes both, and it only matters for the stages that emit a body,
 * which is why it lives here rather than in the generic runner.
 */
import { extractJson } from "@/lib/llm/json";

export const BODY_DELIMITER = "---BODY---";

export interface DelimitedOutput {
  /** Everything before the marker: the stage's short header fields. */
  head: string;
  /** Everything after it, trimmed: the markdown body. */
  body: string;
}

/**
 * The marker only counts on a line of its own.
 *
 * A plain search would match the string anywhere, including inside a code
 * block, and the text being parsed is downstream of somebody's uploaded
 * material. A document that happens to contain `---BODY---`, which is not
 * exotic for anything describing a message format, can carry it into a module
 * body; the concreteness pass then re-emits that body, and the split lands on
 * the content's marker instead of the model's. Nothing is compromised, but the
 * damage shows up on one course, once, and never reproduces.
 */
const BODY_LINE = /^---BODY---[ \t]*$/m;

/** Split at the first marker line, or null when the model did not use the format. */
export function splitAtBody(text: string): DelimitedOutput | null {
  const m = BODY_LINE.exec(text);
  if (!m) return null;
  return {
    head: text.slice(0, m.index),
    body: text.slice(m.index + m[0].length).trim(),
  };
}

/**
 * A parser for a stage whose entire output is one markdown field.
 *
 * The marker earns its keep even with nothing before it: taking the whole reply
 * as the body would fold an opening "Here is the glossary you asked for" into
 * the document itself, and nothing downstream would ever catch it.
 */
export function bodyOnlyParser(field: string): (text: string) => unknown {
  return (text: string) => {
    const split = splitAtBody(text);
    // No marker: the model may still have answered in JSON, which is worth
    // accepting rather than paying for a retry.
    if (!split) return extractJson(text);
    return { [field]: split.body };
  };
}
