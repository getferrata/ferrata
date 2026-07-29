import { extractJson } from "@/lib/llm/json";
import { BODY_DELIMITER, splitAtBody } from "@/lib/llm/tasks/body_delimiter";

/**
 * concreteness_pass speaks the delimiter format: a `NOTES:` block of one-line
 * bullets, a lone `---BODY---` marker, then the revised markdown body.
 *
 * This stage re-emits the entire module, so it is the one that paid the JSON
 * escaping tax hardest: on the first real-model run its output averaged 6.9k
 * tokens against an 8k cap, hit the cap, and was retried in full on almost
 * every module. It was the most expensive stage in the pipeline, and about half
 * of that was the second call.
 */
export { BODY_DELIMITER };

const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** Serialise the way the model is asked to. Used by tests and by the mock provider. */
export function renderConcretenessOutput(
  notes: string[],
  bodyMd: string,
): string {
  const list = notes.length
    ? notes.map((n) => `- ${n}`).join("\n")
    : "- (nothing to report)";
  return `NOTES:\n${list}\n${BODY_DELIMITER}\n${bodyMd}`;
}

/**
 * Parse the delimiter format into the shape the schema validates, falling back
 * to JSON when the marker is absent so a model that still answers in JSON is
 * not hard-failed on a format the schema would accept.
 *
 * Notes are advisory: they are logged, never shown to a learner and never
 * gate acceptance. A malformed notes block therefore must not cost a retry of
 * a body that is fine, so anything unparseable in the head is dropped rather
 * than raised.
 */
export function parseConcretenessOutput(text: string): unknown {
  const split = splitAtBody(text);
  if (!split) return extractJson(text);
  const notes = split.head
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => BULLET.test(line))
    .map((line) => line.replace(BULLET, "").trim())
    .filter(Boolean)
    .slice(0, 40);
  return { bodyMd: split.body, notes };
}
