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

/** Split at the first marker, or null when the model did not use the format. */
export function splitAtBody(text: string): DelimitedOutput | null {
  const idx = text.indexOf(BODY_DELIMITER);
  if (idx === -1) return null;
  return {
    head: text.slice(0, idx),
    body: text.slice(idx + BODY_DELIMITER.length).trim(),
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
