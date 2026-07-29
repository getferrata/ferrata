import { extractJson } from "@/lib/llm/json";
import { BODY_DELIMITER, splitAtBody } from "@/lib/llm/tasks/body_delimiter";

/**
 * write_module speaks the delimiter format: a `TITLE:` line, a lone
 * `---BODY---` marker, then the raw markdown body. See body_delimiter.ts for
 * why the body stays out of JSON.
 */
export { BODY_DELIMITER };

/** Serialise a module the way the model is asked to (used to echo it on repair). */
export function renderModuleOutput(title: string, bodyMd: string): string {
  return `TITLE: ${title}\n${BODY_DELIMITER}\n${bodyMd}`;
}

/**
 * Parse the delimiter format into the shape the schema validates. Falls back to
 * JSON when the marker is absent, so a model that still answers in JSON (or a
 * response with no delimiter) is never hard-failed on a format the schema could
 * otherwise accept.
 */
export function parseModuleOutput(text: string): unknown {
  const split = splitAtBody(text);
  if (!split) {
    // No marker: the model may still have answered in JSON, which is worth
    // accepting. If it did not, say so. Wrapping the whole reply as a body
    // would smuggle any preamble into the module and lean on a distant schema
    // rule to catch it, which is a repair the retry loop can make properly
    // once it is told what went wrong.
    return extractJson(text);
  }
  const title = split.head.replace(/^\s*title\s*:?/i, "").trim();
  return { title, bodyMd: split.body };
}
